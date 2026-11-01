// CLI сигналов конкуренции: pnpm competition
//
// Собирает публичные данные о конкуренции по вакансиям и сравнивает их с рынком:
// - detail-страница (уже спарсена, `pnpm parse`/`pnpm scrape`): просмотры/отклики
//   за 30 дней и за всё время, активность рекрутера, момент последнего ответа;
// - apply_stats (по запросу, с TTL): сколько людей откликнулось, распределения
//   по опыту/English/зарплате, топ навыки откликнувшихся.
//
// Примеры:
//   pnpm competition -- --skills React,TypeScript --window 30 --limit 25
//   pnpm competition -- --job 834543                       # карточка одной вакансии
//   pnpm competition -- --skills React --no-fetch --export # без сети
//   pnpm competition -- --window 90 --limit 100 --export   # сбор рыночной базы
//
// apply_stats — тот эндпоинт, который жмёт кнопка «Огляд кандидатів»
// (GET /api/jobs/<id>/?apply_stats); публичный, без авторизации.
import type { JobApplicantStats, JobPosting, Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { RunTracker } from "../runlog.js";
import { c, ce } from "../log.js";
import { HttpError, RateLimitedFetcher } from "../scraper/fetcher.js";
import { matchSkill } from "../skills/extract.js";
import {
  applicantStatsUrl,
  parseApplicantStats,
} from "./parse-applicant-stats.js";
import {
  computeBaseline,
  computeCompetitionJob,
  decorateRow,
  type CompetitionRow,
} from "./metrics.js";
import { printBaseline, printJobCard, printTable, writeExports } from "./report.js";

type JobWithStats = JobPosting & { applicantStats: JobApplicantStats | null };

const SORT_KEYS = ["opportunity", "competition", "fresh", "applicants"] as const;
type SortKey = (typeof SORT_KEYS)[number];

// ---------- CLI-аргументы ----------

function arg(name: string, def: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  const value = process.argv[idx + 1];
  if (value.startsWith("--")) return def; // флаг без значения
  return value;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function intArg(name: string, def: number, min: number): number {
  const raw = arg(name);
  if (raw === null) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < min) {
    console.error(ce.red(`--${name}: некорректное число`), `"${raw}" (минимум ${min})`);
    process.exit(1);
  }
  return n;
}

function resolveSkillName(raw: string): string {
  const resolved = matchSkill(raw);
  if (!resolved) {
    console.warn(`[competition] навык ${ce.yellow(`"${raw}"`)} не найден в словаре — используем как есть`);
    return raw;
  }
  return resolved.name;
}

// ---------- Выборка ----------

function buildWhere(opts: {
  jobIds: number[];
  skills: string[];
  category: string | null;
  windowDays: number;
}): Prisma.JobPostingWhereInput {
  // Явные id имеют приоритет: остальные фильтры игнорируются
  if (opts.jobIds.length > 0) return { status: "ACTIVE", id: { in: opts.jobIds } };

  const since = opts.windowDays > 0 ? new Date(Date.now() - opts.windowDays * 86_400_000) : null;
  return {
    status: "ACTIVE",
    // Актуальность: поднятые обновлением вакансии («Оновлено …») не должны
    // выпадать из окна из-за старой даты публикации.
    ...(since
      ? { OR: [{ datePosted: { gte: since } }, { updatedAtDjinni: { gte: since } }] }
      : {}),
    ...(opts.skills.length > 0
      ? { skills: { some: { skill: { name: { in: opts.skills } } } } }
      : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
}

const ORDER_BY: Prisma.JobPostingOrderByWithRelationInput[] = [
  { updatedAtDjinni: { sort: "desc", nulls: "last" } },
  { datePosted: { sort: "desc", nulls: "last" } },
];

// ---------- Сбор apply_stats ----------

async function fetchApplicantStats(
  jobs: JobWithStats[],
  fetcher: RateLimitedFetcher,
  tracker: RunTracker,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;

  for (const job of jobs) {
    const url = applicantStatsUrl(config.baseUrl, job.id);
    try {
      const raw = await fetcher.fetch(url, "application/json");
      const stats = parseApplicantStats(raw);
      if (!stats) {
        failed++;
        console.warn(`[competition] #${job.id}: ${ce.yellow("неожиданный ответ")} apply_stats — пропускаем`);
        continue;
      }
      const data = {
        totalApplicants: stats.totalApplicants,
        experienceDist: stats.experience as unknown as Prisma.InputJsonValue,
        salaryDist: stats.salary as unknown as Prisma.InputJsonValue,
        englishDist: stats.english as unknown as Prisma.InputJsonValue,
        topSkills: stats.topSkills as unknown as Prisma.InputJsonValue,
        rawJson: raw,
        fetchedAt: new Date(),
      };
      await prisma.jobApplicantStats.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, ...data },
        update: data,
      });
      ok++;
      console.log(
        `[competition] #${job.id} ${c.bold(truncate(job.title, 44))} → ` +
          `${c.bold(String(stats.totalApplicants))} откликов`,
      );
    } catch (err) {
      failed++;
      if (err instanceof HttpError && err.status === 404) {
        console.warn(`[competition] #${job.id}: ${ce.dim("404 — статистики нет")}`);
        continue;
      }
      console.warn(`[competition] #${job.id}: ${ce.red(String(err instanceof Error ? err.message : err))}`);
    }
  }

  tracker.countJobsStatsFetched(ok);
  return { ok, failed };
}

// ---------- Ранжирование ----------

function sortRows(rows: CompetitionRow[], key: SortKey): void {
  const comparators: Record<SortKey, (a: CompetitionRow, b: CompetitionRow) => number> = {
    // Легче/выгоднее податься: меньше конкуренции + свежесть + активный рекрутер
    opportunity: (a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1),
    // Меньше конкуренции вверху
    competition: (a, b) => (a.appsPerDay ?? Infinity) - (b.appsPerDay ?? Infinity),
    fresh: (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
    applicants: (a, b) => (a.totalApplicants ?? Infinity) - (b.totalApplicants ?? Infinity),
  };
  rows.sort(comparators[key]);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------- main ----------

async function main(): Promise<void> {
  const now = new Date();
  const jobIds = (arg("job") ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  const skills = (arg("skills") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(resolveSkillName);
  const category = arg("category");
  const windowDays = intArg("window", config.competition.defaultWindowDays, 0);
  const limit = intArg("limit", config.competition.defaultLimit, 1);
  const ttlHours = intArg("ttl-hours", config.competition.ttlHours, 0);
  const force = has("force");
  const noFetch = has("no-fetch");
  const dryRun = has("dry-run");
  const doExport = has("export");
  const sortRaw = arg("sort", "opportunity") ?? "opportunity";
  if (!SORT_KEYS.includes(sortRaw as SortKey)) {
    console.error(ce.red("--sort: неизвестное значение"), `${sortRaw} (доступно: ${SORT_KEYS.join(", ")})`);
    process.exit(1);
  }
  const sortKey = sortRaw as SortKey;

  if (limit > 500) {
    console.warn(`[competition] ${ce.yellow("--limit больше 500")} — один прогон займёт ~${Math.round((limit * 5.5) / 60)} мин при паузе 3–8 с`);
  }

  const where = buildWhere({ jobIds, skills, category, windowDays });
  const tracker = await RunTracker.start("SCRAPE_COMPETITION");

  try {
    const load = (): Promise<JobWithStats[]> =>
      prisma.jobPosting.findMany({ where, orderBy: ORDER_BY, take: limit, include: { applicantStats: true } });

    let jobs = await load();
    if (jobs.length === 0) {
      console.warn(
        `[competition] ${ce.yellow("под фильтр не попала ни одна вакансия")} — ` +
          `проверь --window/--skills/--category или собери данные: pnpm scrape`,
      );
      await tracker.finish();
      return;
    }

    const selectionNote = [
      skills.length > 0 ? `навыки ${skills.join(", ")}` : null,
      category ? `категория ${category}` : null,
      jobIds.length > 0 ? `id ${jobIds.join(",")}` : windowDays > 0 ? `окно ${windowDays} дн.` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(
      `[competition] выборка: ${c.bold(String(jobs.length))} вакансий${selectionNote ? ` ${c.dim(`(${selectionNote})`)}` : ""}`,
    );

    // Добор apply_stats: только устаревшие/отсутствующие снапшоты, с TTL
    const cutoff = new Date(now.getTime() - ttlHours * 3_600_000);
    const stale = jobs.filter((j) => force || !j.applicantStats || j.applicantStats.fetchedAt < cutoff);
    const fresh = jobs.length - stale.length;

    if (dryRun) {
      console.log(`[competition] ${c.yellow("dry-run")}: запросов не делаем, качать было бы ${c.bold(String(stale.length))} (свежих ${fresh})`);
    } else if (noFetch) {
      console.log(`[competition] ${c.dim("--no-fetch")}: снапшотов из кэша ${fresh}, без статистики ${stale.length}`);
    } else if (stale.length === 0) {
      console.log(`[competition] снапшоты свежие (TTL ${ttlHours} ч) — запросов не делаем`);
    } else {
      console.log(`[competition] качаем apply_stats: ${c.bold(String(stale.length))} ${c.dim(`(свежих ${fresh}, TTL ${ttlHours} ч)`)}`);
      const fetcher = new RateLimitedFetcher(() => tracker.countRequest());
      const { ok, failed } = await fetchApplicantStats(stale, fetcher, tracker);
      console.log(`[competition] готово: ${c.green(String(ok))} снапшотов, ${failed === 0 ? "0" : c.yellow(String(failed))} ошибок`);
      if (ok > 0) jobs = await load(); // перечитать со свежими снапшотами
    }

    // Baseline — ВСЕ активные вакансии с apply_stats (не только выборка)
    const allStats = await prisma.jobApplicantStats.findMany({ include: { job: true } });
    const baselineJobs = allStats
      .filter((s) => s.job.status === "ACTIVE")
      .map((s) => computeCompetitionJob({ ...s.job, applicantStats: s }, now))
      .filter((r) => r.totalApplicants !== null && r.appsPerDay !== null);

    const baseline = computeBaseline(
      baselineJobs.map((r) => ({
        totalApplicants: r.totalApplicants ?? 0,
        appsPerDay: r.appsPerDay ?? 0,
        replyRate: r.replyRate,
        statsAgeDays: r.statsAgeDays ?? 0,
      })),
    );
    const values = {
      appsPerDay: baselineJobs.map((r) => r.appsPerDay).filter((v): v is number => v !== null),
      totals: baselineJobs.map((r) => r.totalApplicants).filter((v): v is number => v !== null),
      replyRates: baselineJobs.map((r) => r.replyRate).filter((v): v is number => v !== null),
    };

    const rows = jobs.map((j) => decorateRow(computeCompetitionJob(j, now), baseline, values, now));
    sortRows(rows, sortKey);

    printBaseline(baseline);
    if (rows.length === 1) printJobCard(rows[0], baseline);
    else printTable(rows);

    if (doExport) {
      const { jsonPath, csvPath } = await writeExports(rows, {
        selection: {
          jobIds: jobIds.length > 0 ? jobIds : null,
          skills,
          category,
          windowDays: jobIds.length > 0 ? null : windowDays,
          limit,
          sort: sortKey,
        },
        baseline,
      });
      console.log(`\n  JSON: ${c.cyan(jsonPath)}\n  CSV:  ${c.cyan(csvPath)}`);
    }

    await tracker.finish();
  } catch (err) {
    await tracker.finish(err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(ce.red("[competition] фатальная ошибка:"), err);
  process.exit(1);
});
