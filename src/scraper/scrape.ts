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
}

export async function runScrape(opts: ScrapeRunOptions): Promise<void> {
  const listTtlDays = opts.listTtlDays ?? config.listTtlDays;
  const detailTtlDays = opts.detailTtlDays ?? config.detailTtlDays;

  const tracker = await RunTracker.start("SCRAPE_RUN");
  const fetcher = new RateLimitedFetcher(() => tracker.countRequest());
  const store = createRawStore();

  try {
    // Этап 1: список страниц (TTL 1 день — инвалидирует все страницы разом)
    const listState = await store.getListState();
    const listAgeDays = listState
      ? (Date.now() - listState.fetchedAt.getTime()) / 86_400_000
      : Infinity;
    let discoveredIds: number[] = [];

    if (listState && listAgeDays < listTtlDays && opts.pages <= listState.pagesFetched) {
      // Список свежий — страницы из кэша, без запросов
      console.log(
        `[scrape] список свежий ${c.dim(`(${listAgeDays.toFixed(2)} дн. < ${listTtlDays})`)} — ` +
          `берём ids из кэша страниц, запросов не делаем`,
      );
      tracker.countPageCacheHit();
      discoveredIds = listState.ids;
    } else {
      console.log(
        `[scrape] обход ${c.bold(String(opts.pages))} страниц списка ${c.dim(`(TTL ${listTtlDays} дн.)`)}…`,
      );
      discoveredIds = await scrapeListPages(fetcher, tracker, store, opts);
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
): Promise<number[]> {
  const ids: number[] = [];
  let newCount = 0;
  let updatedCount = 0;

  for (let page = 1; page <= opts.pages; page++) {
    const url = `${config.baseUrl}/jobs/?page=${page}`;
    console.log(`[scrape] GET ${c.cyan(url)}`);
    const html = await fetcher.fetch(url);
    tracker.countPageFetched();

    const { items, jsonLdCount } = parseListPage(html, url);
    if (items.length === 0) {
      console.warn(`[scrape] страница ${page}: 0 вакансий ${ce.dim(`(jsonLd=${jsonLdCount})`)} — возможно, конец списка`);
      break;
    }

    // Сохраняем сырой HTML списка (одна запись на страницу — перезапись при обновлении)
    let rawRef: string | null = null;
    if (!opts.dryRun) {
      rawRef = await store.put("LIST", `page-${page}`, url, html);
    }

    for (const item of items) {
      ids.push(item.id);
      if (opts.dryRun) continue;
      const { isNew } = await upsertJobFromList(item, rawRef);
      if (isNew) newCount++;
      else updatedCount++;
    }

    console.log(`[scrape] страница ${page}: ${c.green(String(items.length))} вакансий ${c.dim(`(всего ids: ${ids.length})`)}`);
  }

  if (!opts.dryRun) {
    tracker.countJobsNew(newCount);
    tracker.countJobsUpdated(updatedCount);
    await store.saveListState({ ids, pagesFetched: opts.pages, fetchedAt: new Date() });
  }

  return ids;
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
    console.log(`[scrape] GET ${c.cyan(url)}`);
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
      console.warn(`[scrape] не удалось разобрать detail-страницу ${ce.cyan(url)}`);
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
      `         опубликовано ${c.blue(published)} · обновлено ${c.blue(updated)}\n` +
      `         навыков ${c.green(String(detail.skills.length))}` +
      `${skillNames ? c.green(` (${skillNames})`) : ""}, ` +
      `английский ${detail.englishLevel}, опыт ${c.bold(String(detail.experienceYears ?? "?"))} лет`,
  );
}

/** ISO-дата без времени: 2026-10-23. */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
