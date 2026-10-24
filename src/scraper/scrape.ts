// Сбор данных djinni.co с защитой от перегрузки и TTL-кэшем.
//
// TTL (решение 2026-10-24):
// - страницы списка — 1 день: нумерация последующих страниц сдвигается при любых
//   изменениях, поэтому либо весь список свежий, либо перескачиваем заново;
// - детали вакансии — 7 дней (конфигурируемо), НО приоритетнее «дата обновления
//   на djinni» («Оновлено …»): перекачиваем, если обновление новее detailCachedAt.
//
// Лимиты одного запуска: --pages (страниц списка, default 5) и
// --vacancies (detail-страниц, default 5).
import { config } from "../config.js";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { parseListPage } from "../parser/parse-list.js";
import { parseDetailPage, type ParsedDetail } from "../parser/parse-detail.js";
import { extractJobSkills } from "../skills/extract.js";
import { updateJobFromDetail, upsertJobFromList } from "../storage.js";
import { createRawStore, type RawStore } from "../storage/raw-store.js";
import { RunTracker } from "../runlog.js";
import { c, ce } from "../log.js";
import { HttpError, RateLimitedFetcher } from "./fetcher.js";

export interface ScrapeRunOptions {
  pages: number; // страниц списка за запуск
  vacancies: number; // detail-страниц за запуск
  listTtlDays?: number;
  detailTtlDays?: number;
  dryRun?: boolean; // не писать в БД/кэш, только отчёт
  /** Категории фильтра (primary_keyword); дефолт — config.filter.primaryKeywords (CLI --keywords переопределяет). */
  primaryKeywords?: string[];
}

/**
 * Fingerprint списка категорий фильтра (sha256 от отсортированного списка).
 * Сохраняется в ListCacheState: смена фильтра делает кэш списка устаревшим,
 * т.к. набор ids другой. Сортировка делает его инвариантным к порядку в env.
 */
export function listFilterFingerprint(keywords: string[]): string {
  const canonical = [...keywords].map((k) => k.trim()).sort().join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** URL страницы списка с фильтром: повторяющиеся primary_keyword (мультивыбор категории djinni). */
export function buildListUrl(page: number, keywords: string[]): string {
  const parts: string[] = [];
  if (keywords.length > 0) parts.push("search_type=basic-search");
  for (const kw of keywords) parts.push(`primary_keyword=${encodeURIComponent(kw)}`);
  parts.push(`page=${page}`);
  return `${config.baseUrl}/jobs/?${parts.join("&")}`;
}

export async function runScrape(opts: ScrapeRunOptions): Promise<void> {
  const listTtlDays = opts.listTtlDays ?? config.listTtlDays;
  const detailTtlDays = opts.detailTtlDays ?? config.detailTtlDays;
  const primaryKeywords = opts.primaryKeywords ?? config.filter.primaryKeywords;
  const filterFp = listFilterFingerprint(primaryKeywords);
  console.log(
    primaryKeywords.length > 0
      ? `[scrape] фильтр категорий (${primaryKeywords.length}): ${c.bold(primaryKeywords.join(", "))}`
      : `[scrape] фильтр категорий ${c.yellow("выключен")} — обход всех вакансий`,
  );

  const tracker = await RunTracker.start("SCRAPE_RUN");
  const fetcher = new RateLimitedFetcher(() => tracker.countRequest());
  const store = createRawStore();

  try {
    // Этап 1: список страниц (TTL 1 день — инвалидирует все страницы разом;
    // смена фильтра тоже делает кэш устаревшим — проверка по fingerprint)
    const listState = await store.getListState();
    const listAgeDays = listState
      ? (Date.now() - listState.fetchedAt.getTime()) / 86_400_000
      : Infinity;
    const sameFilter = (listState?.filterFingerprint ?? null) === filterFp;
    // Список «полон»: в кэше уже все вакансии (ids.length >= totalCount) —
    // при любом --pages кэш-хит, перекачивать нечего.
    const listComplete =
      listState?.totalCount != null && listState.ids.length >= listState.totalCount;
    let discoveredIds: number[] = [];

    if (
      listState &&
      listAgeDays < listTtlDays &&
      sameFilter &&
      (opts.pages <= listState.pagesFetched || listComplete)
    ) {
      // Список свежий — страницы из кэша, без запросов
      const completeNote = listComplete
        ? c.dim(`, список полный: ${listState.ids.length}/${listState.totalCount}`)
        : "";
      console.log(
        `[scrape] список свежий ${c.dim(`(${listAgeDays.toFixed(2)} дн. < ${listTtlDays})`)}${completeNote} — ` +
          `берём ids из кэша страниц, запросов не делаем`,
      );
      tracker.countPageCacheHit();
      discoveredIds = listState.ids;
    } else {
      if (listState && !sameFilter) {
        console.log(`[scrape] ${c.yellow("фильтр изменился")} — кэш списка устарел, перекачиваем все страницы`);
      }
      console.log(
        `[scrape] обход ${c.bold(String(opts.pages))} страниц списка ${c.dim(`(TTL ${listTtlDays} дн.)`)}…`,
      );
      discoveredIds = await scrapeListPages(fetcher, tracker, store, opts, primaryKeywords, filterFp);
    }

    // Этап 2: detail-очередь — новые/просроченные/изменённые
    const detailQueue = await buildDetailQueue(discoveredIds, detailTtlDays, opts.vacancies);
    if (detailQueue.length === 0) {
      console.log("[scrape] очередь detail-страниц пуста — нечего качать");
    } else {
      console.log(
        `[scrape] качаем ${c.bold(String(detailQueue.length))} detail-страниц ${c.dim(`(TTL ${detailTtlDays} дн.)`)}…`,
      );
      await scrapeDetails(fetcher, tracker, store, detailQueue, opts);
    }

    await tracker.finish();
  } catch (err) {
    await tracker.finish(err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

// ---------- Этап 1: страницы списка ----------

async function scrapeListPages(
  fetcher: RateLimitedFetcher,
  tracker: RunTracker,
  store: RawStore,
  opts: ScrapeRunOptions,
  keywords: string[],
  filterFp: string,
): Promise<number[]> {
  const seenAll = new Set<number>(); // дедупликация ids через страницы
  let newCount = 0;
  let updatedCount = 0;
  let pagesFetched = 0; // фактически обработанные страницы (для state)
  let expectedTotal: number | undefined;

  for (let page = 1; page <= opts.pages; page++) {
    const url = buildListUrl(page, keywords);
    console.log(`[scrape] GET ${c.blue(url)}`);
    const html = await fetcher.fetch(url);
    tracker.countPageFetched();

    const { items, jsonLdCount, totalCount } = parseListPage(html, url);
    if (page === 1) {
      expectedTotal = totalCount;
      if (totalCount !== undefined) {
        console.log(`[scrape] всего вакансий${keywords.length > 0 ? " с фильтром" : ""}: ${c.bold(String(totalCount))}`);
      }
    }
    if (items.length === 0) {
      console.warn(`[scrape] страница ${page}: 0 вакансий ${ce.dim(`(jsonLd=${jsonLdCount})`)} — возможно, конец списка`);
      break;
    }

    // Сохраняем сырой HTML списка (одна запись на страницу — перезапись при обновлении)
    let rawRef: string | null = null;
    if (!opts.dryRun) {
      rawRef = await store.put("LIST", `page-${page}`, url, html);
    }

    let pageNewIds = 0;
    for (const item of items) {
      const isNewId = !seenAll.has(item.id);
      if (isNewId) {
        seenAll.add(item.id);
        pageNewIds++;
      }
      if (opts.dryRun || !isNewId) continue; // повтор уже обработан в этом запуске
      const { isNew } = await upsertJobFromList(item, rawRef);
      if (isNew) newCount++;
      else updatedCount++;
    }
    pagesFetched = page;

    console.log(
      `[scrape] страница ${page}: ${c.green(String(items.length))} вакансий ${c.dim(`(уникальных: ${seenAll.size}${expectedTotal !== undefined ? ` из ${expectedTotal}` : ""})`)}`,
    );

    // Стоп-критерии конца списка: djinni за концом отдаёт не пустые, а ПОВТОРЯЮЩИЕСЯ
    // страницы (page-19 = page-20), поэтому одной проверки пустой страницы недостаточно.
    if (expectedTotal !== undefined && seenAll.size >= expectedTotal) {
      const pageWord = page % 10 >= 2 && page % 10 <= 4 && !(page % 100 >= 12 && page % 100 <= 14) ? "ы" : "";
      console.log(
        `[scrape] конец списка: ${c.bold(String(seenAll.size))} вакансий собрано за ${page} страниц${pageWord}`,
      );
      break;
    }
    if (pageNewIds === 0) {
      console.warn(
        `[scrape] страница ${page}: ${ce.yellow("0 новых ids")} — djinni повторяет уже собранный контент, выходим из списка`,
      );
      break;
    }
  }

  if (!opts.dryRun) {
    tracker.countJobsNew(newCount);
    tracker.countJobsUpdated(updatedCount);
    await store.saveListState({
      ids: [...seenAll],
      pagesFetched,
      fetchedAt: new Date(),
      filterFingerprint: filterFp,
      totalCount: expectedTotal ?? null,
    });
  }

  return [...seenAll];
}

// ---------- Этап 2: detail-страницы ----------

/**
 * Очередь detail-страниц по приоритету:
 * 1. новые (нет в БД или без detailCachedAt);
 * 2. обновлённые на djinni (updatedAtDjinni из списка? нет — из прошлого detail;
 *    здесь — по datePosted из списка новее detailCachedAt);
 * 3. просроченные по TTL (detailCachedAt старше detailTtlDays).
 */
async function buildDetailQueue(
  discoveredIds: number[],
  detailTtlDays: number,
  limit: number,
): Promise<number[]> {
  const cutoff = new Date(Date.now() - detailTtlDays * 86_400_000);

  const jobs = await prisma.jobPosting.findMany({
    where: { id: { in: discoveredIds } },
    select: { id: true, detailCachedAt: true, datePosted: true, updatedAtDjinni: true },
  });

  const fresh: number[] = []; // никогда не качали
  const changed: number[] = []; // обновились на djinni после нашей копии
  const expired: number[] = []; // TTL истёк

  for (const job of jobs) {
    if (!job.detailCachedAt) {
      fresh.push(job.id);
      continue;
    }
    // Обновление на djinni: «Оновлено» (из прошлого detail-парса) новее нашей копии
    const lastKnownUpdate = job.updatedAtDjinni ?? job.datePosted;
    if (lastKnownUpdate && lastKnownUpdate > job.detailCachedAt) {
      changed.push(job.id);
      continue;
    }
    if (job.detailCachedAt < cutoff) expired.push(job.id);
  }

  const queue = [...changed, ...fresh, ...expired];
  return queue.slice(0, limit);
}

async function scrapeDetails(
  fetcher: RateLimitedFetcher,
  tracker: RunTracker,
  store: RawStore,
  queue: number[],
  opts: ScrapeRunOptions,
): Promise<void> {
  let refetched = 0;

  for (const jobId of queue) {
    const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
    if (!job) continue;

    const url = job.url;
    console.log(`[scrape] GET ${c.blue(url)}`);
    let html: string;
    try {
      html = await fetcher.fetch(url);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // Вакансия удалена с djinni — помечаем
        console.warn(`[scrape] вакансия ${ce.yellow(String(jobId))} вернула ${ce.red("404")} — помечаем EXPIRED`);
        if (!opts.dryRun) {
          await prisma.jobPosting.update({
            where: { id: jobId },
            data: { status: "EXPIRED" },
          });
        }
        continue;
      }
      throw err;
    }
    tracker.countPageFetched();

    const detail = parseDetailPage(html, url);
    if (!detail) {
      console.warn(`[scrape] не удалось разобрать detail-страницу ${ce.blue(url)}`);
      continue;
    }

    let rawRef: string | null = null;
    if (!opts.dryRun) {
      rawRef = await store.put("DETAIL", String(jobId), url, html);
      await updateJobFromDetail(detail, rawRef);

      // Извлечение навыков: структурированные djinni + keyword-слой
      const { resolved, unresolvedNames } = await extractJobSkills({
        jobId,
        structuredSkills: detail.skills.map((s) => ({
          name: s.name,
          yearsRequired: s.yearsRequired,
          source: s.source,
        })),
        description: detail.description,
      });
      tracker.countSkillsLinked(resolved.length);
      if (unresolvedNames.length > 0) {
        console.log(
          `[scrape] вакансия ${c.bold(String(jobId))}: ` +
            `${c.yellow("нераспознанные навыки")} ${c.dim("(кандидаты в словарь)")}: ` +
            c.yellow(unresolvedNames.join(", ")),
        );
      }
    }

    refetched++;
    printVacancySummary(jobId, detail);
  }

  tracker.countJobsRefetched(refetched);
}

/**
 * Итоговая сводка по вакансии в консоль: заголовок, даты публикации/обновления,
 * навыки/язык/опыт. Одна вакансия — один блок из трёх строк.
 */
export function printVacancySummary(
  jobId: number,
  detail: ParsedDetail,
  label = "[scrape]",
): void {
  const title =
    detail.title.length > 60 ? `${detail.title.slice(0, 57)}…` : detail.title;
  const published = detail.datePosted ? formatDate(detail.datePosted) : "?";
  const updated = detail.updatedAtDjinni
    ? formatDate(detail.updatedAtDjinni)
    : "— (не обновлялась)";
  const skillNames = detail.skills.map((s) => s.name).join(", ");

  console.log(
    `${label} вакансия ${c.bold(String(jobId))} ${c.magenta(`«${title}»`)}\n` +
      `         опубликовано ${c.cyan(published)} · обновлено ${c.cyan(updated)}\n` +
      `         навыков ${c.green(String(detail.skills.length))}` +
      `${skillNames ? c.green(` (${skillNames})`) : ""}, ` +
      `английский ${detail.englishLevel}, опыт ${c.bold(String(detail.experienceYears ?? "?"))} лет`,
  );
}

/** ISO-дата без времени: 2026-10-23. */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
