// Вывод сигналов конкуренции: сводка по рынку, таблица шортлиста, карточка вакансии,
// экспорт JSON/CSV в cache/analysis/. Всё без сети — читает посчитанные метрики.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { csvCell } from "../analysis/csv.js";
import { c, pad } from "../log.js";
import { daysAgoRu, isoDate, percentileLabel, recruiterActivityRu } from "./labels.js";
import {
  MIN_BASELINE_N,
  type CompetitionBaseline,
  type CompetitionRow,
} from "./metrics.js";

/** Выравнивание по правому краю (числовые колонки таблицы). */
function right(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

// ---------- Сводка по рынку ----------

export function printBaseline(baseline: CompetitionBaseline): void {
  const ok = baseline.n >= MIN_BASELINE_N;
  const age = baseline.statsAgeDays.toFixed(1);
  if (!ok) {
    console.log(
      `[competition] рынок: n=${c.bold(String(baseline.n))} снапшотов ${c.dim(`(медианный возраст ${age} дн.)`)} — ` +
        `перцентили и флаги конкуренции не считаются, нужно ≥ ${MIN_BASELINE_N}`,
    );
    console.log(`  собрать базу: ${c.cyan("pnpm competition -- --limit 50 --export")}`);
    return;
  }
  console.log(
    `[competition] рынок: n=${c.bold(String(baseline.n))} ${c.dim(`(снапшоты в среднем ${age} дн. назад)`)}`,
  );
  console.log(
    `  отклики/день: медиана ${c.bold(baseline.appsPerDay.median.toFixed(1))} · ` +
      `p25 ${baseline.appsPerDay.p25.toFixed(1)} · p75 ${baseline.appsPerDay.p75.toFixed(1)} · p90 ${baseline.appsPerDay.p90.toFixed(1)}`,
  );
  console.log(
    `  откликов всего: медиана ${c.bold(String(Math.round(baseline.totalApplicants.median)))} · ` +
      `p25 ${Math.round(baseline.totalApplicants.p25)} · p75 ${Math.round(baseline.totalApplicants.p75)} · p90 ${Math.round(baseline.totalApplicants.p90)}`,
  );
  console.log(
    `  reply rate (отклики/просмотры): медиана ${pctStr(baseline.replyRate.median)} · ` +
      `p75 ${pctStr(baseline.replyRate.p75)}`,
  );
}

// ---------- Таблица шортлиста ----------

export function printTable(rows: CompetitionRow[]): void {
  const head =
    `  #  ${pad("Вакансия", 44)} ${right("Обновлена", 10)} ` +
    `${right("Откл.", 6)} ${right("30д", 4)} ${right("/день", 7)} ` +
    `${right("pct", 4)} ${pad("Рекрутер", 24)} Флаги`;
  console.log(`\n${c.bold(head)}`);

  rows.forEach((row, i) => {
    const rank = String(i + 1).padStart(2);
    const title = truncate(`${row.job.title} (${row.job.company ?? "?"})`, 44);
    const line =
      `${rank}  ${pad(title, 44)} ${right(ageLabel(row.daysSinceActivity), 10)} ` +
      `${right(row.totalApplicants === null ? "—" : String(row.totalApplicants), 6)} ` +
      `${right(row.job.replies30d === null ? "—" : String(row.job.replies30d), 4)} ` +
      `${right(row.appsPerDay === null ? "—" : row.appsPerDay.toFixed(1), 7)} ` +
      `${right(percentileLabel(row.percentile.competition), 4)} ` +
      `${pad(recruiterCell(row), 24)} ${row.flags.join(", ")}`;
    console.log(line);
  });
}

// ---------- Карточка одной вакансии ----------

export function printJobCard(row: CompetitionRow, baseline: CompetitionBaseline): void {
  const job = row.job;
  const title = job.title.length > 70 ? `${job.title.slice(0, 67)}…` : job.title;
  console.log(
    `\n${c.bold(`#${job.id}`)} ${c.magenta(`«${title}»`)}${job.company ? ` — ${job.company}` : ""} ` +
      `${c.dim(job.url)}`,
  );
  console.log(
    `  опубликовано ${c.cyan(isoDate(job.datePosted))} · обновлено ${c.cyan(isoDate(job.updatedAtDjinni))} · ` +
      `вакансия ${ageLabel(row.ageDays)} · detail-кэш ${c.dim(isoDate(job.detailCachedAt))}`,
  );

  const total = row.totalApplicants === null ? c.yellow("нет данных") : `${c.bold(String(row.totalApplicants))} откликов`;
  const perDay = row.appsPerDay === null ? "" : ` (${row.appsPerDay.toFixed(1)}/день)`;
  const window = job.replies30d !== null
    ? ` · за 30 дн.: ${job.replies30d} откликов / ${job.views30d ?? "?"} просмотров`
    : "";
  const rate = row.replyRate === null ? "" : ` · reply rate ${pctStr(row.replyRate)}`;
  console.log(`  отклики: ${total}${perDay}${window}${rate}`);

  if (row.percentile.competition !== null && baseline.n >= MIN_BASELINE_N) {
    console.log(
      `  рынок (n=${baseline.n}): медиана ${c.bold(baseline.appsPerDay.median.toFixed(1))} откл./день · ` +
        `вакансия ${c.bold(percentileLabel(row.percentile.competition))} ` +
        `${c.dim("(доля вакансий с тем же или меньшим темпом)")}`,
    );
  } else {
    console.log(`  рынок: n=${baseline.n} — ${c.yellow("перцентили не считаются")} (мало данных)`);
  }

  const resp = row.recruiter.lastResponseAt !== null && row.recruiter.daysSinceResponse !== null
    ? `${isoDate(row.recruiter.lastResponseAt)} (${daysAgoRu(row.recruiter.daysSinceResponse)})`
    : "—";
  const label = row.recruiter.label ? c.dim(` [${row.recruiter.label}]`) : "";
  console.log(
    `  рекрутер: активность ${c.bold(recruiterActivityRu(row.recruiter.activity))} · отвечали ${resp}${label}`,
  );

  if (row.pool) {
    const exp = row.pool.reportedExperience > 0
      ? `опыт (n=${row.pool.reportedExperience}): ` +
        `${row.pool.experience5PlusShare !== null ? `${Math.round(row.pool.experience5PlusShare * 100)}% с 5+ годами` : "?"}` +
        `${row.pool.medianExperienceYears !== null ? `, медиана ${row.pool.medianExperienceYears.toFixed(1)} г.` : ""}`
      : "опыт не указан";
    const eng = row.pool.englishReported > 0 ? ` · English: ${row.pool.englishTop} (n=${row.pool.englishReported})` : "";
    const sal = row.pool.salaryReported > 0 && row.pool.salaryMedianUsd !== null
      ? ` · ожидания ~$${Math.round(row.pool.salaryMedianUsd)} (n=${row.pool.salaryReported})`
      : "";
    console.log(`  кандидаты: ${exp}${eng}${sal}`);
    if (row.pool.topSkills.length > 0) {
      const skills = row.pool.topSkills.map((s) => `${s.name} ${c.bold(String(s.count))}`).join(", ");
      console.log(`  топ навыков откликнувшихся: ${skills}`);
    }
  } else {
    console.log(`  кандидаты: ${c.yellow("нет данных")} — снапшот apply_stats не собран`);
  }

  const score = row.opportunityScore === null ? "—" : row.opportunityScore.toFixed(2);
  console.log(
    `  флаги: ${row.flags.length > 0 ? row.flags.join(", ") : "—"} · ` +
      `opportunity score ${c.bold(score)} ${c.dim("(«легче/выгоднее податься», не «подходит по стеку»)")}`,
  );
}

// ---------- Экспорт ----------

export interface CompetitionExportMeta {
  selection: {
    jobIds: number[] | null;
    skills: string[];
    category: string | null;
    windowDays: number | null;
    limit: number;
    sort: string;
  };
  baseline: CompetitionBaseline;
}

export async function writeExports(
  rows: CompetitionRow[],
  meta: CompetitionExportMeta,
): Promise<{ jsonPath: string; csvPath: string }> {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = meta.selection.skills.length > 0
    ? `-${meta.selection.skills.map((s) => s.toLowerCase()).join("+")}`
    : "";
  const base = `competition-${date}${suffix}`;

  const snapshot = {
    meta: {
      generatedAt: new Date().toISOString(),
      selection: meta.selection,
      baseline: meta.baseline,
      minBaselineN: MIN_BASELINE_N,
      source: "djinni.co (detail-страница + /api/jobs/<id>/?apply_stats)",
    },
    jobs: rows.map((r) => ({
      id: r.job.id,
      url: r.job.url,
      title: r.job.title,
      company: r.job.company,
      category: r.job.category,
      datePosted: r.job.datePosted?.toISOString() ?? null,
      updatedAtDjinni: r.job.updatedAtDjinni?.toISOString() ?? null,
      ageDays: round(r.ageDays),
      lastActivityAt: r.lastActivityAt.toISOString(),
      totalApplicants: r.totalApplicants,
      appsPerDay: round(r.appsPerDay),
      lifetimeAppsPerDay: round(r.lifetimeAppsPerDay),
      recentAppsPerDay: round(r.recentAppsPerDay),
      views30d: r.job.views30d,
      replies30d: r.job.replies30d,
      replyRate: round(r.replyRate),
      percentile: {
        competition: round(r.percentile.competition),
        volume: round(r.percentile.volume),
        interest: round(r.percentile.interest),
      },
      recruiter: {
        activity: r.recruiter.activity,
        lastResponseAt: r.recruiter.lastResponseAt?.toISOString() ?? null,
        daysSinceResponse: round(r.recruiter.daysSinceResponse),
        label: r.recruiter.label,
      },
      applicantPool: r.pool
        ? {
            reportedExperience: r.pool.reportedExperience,
            experience5PlusShare: round(r.pool.experience5PlusShare),
            medianExperienceYears: round(r.pool.medianExperienceYears),
            englishTop: r.pool.englishTop,
            englishReported: r.pool.englishReported,
            salaryMedianUsd: round(r.pool.salaryMedianUsd),
            salaryReported: r.pool.salaryReported,
            topSkills: r.pool.topSkills,
          }
        : null,
      applicantStats: r.job.applicantStats
        ? {
            experience: r.job.applicantStats.experienceDist,
            salary: r.job.applicantStats.salaryDist,
            english: r.job.applicantStats.englishDist,
            topSkills: r.job.applicantStats.topSkills,
          }
        : null,
      statsFetchedAt: r.job.applicantStats?.fetchedAt.toISOString() ?? null,
      detailCachedAt: r.job.detailCachedAt?.toISOString() ?? null,
      flags: r.flags,
      opportunityScore: round(r.opportunityScore),
    })),
  };

  const header = [
    "job_id", "url", "title", "company", "category", "date_posted", "updated_at_djinni",
    "age_days", "last_activity_at",
    "total_applicants", "apps_per_day", "lifetime_apps_per_day", "recent_apps_per_day",
    "views_30d", "replies_30d", "reply_rate",
    "competition_percentile", "volume_percentile", "interest_percentile",
    "recruiter_activity", "recruiter_last_response_at", "recruiter_response_label",
    "pool_experience_n", "pool_5plus_share", "pool_median_years",
    "pool_english_top", "pool_salary_median_usd", "pool_top_skills",
    "opportunity_score", "flags", "stats_fetched_at", "detail_cached_at",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.job.id, r.job.url, r.job.title, r.job.company, r.job.category,
        r.job.datePosted?.toISOString() ?? "", r.job.updatedAtDjinni?.toISOString() ?? "",
        round(r.ageDays), r.lastActivityAt.toISOString(),
        r.totalApplicants, round(r.appsPerDay), round(r.lifetimeAppsPerDay), round(r.recentAppsPerDay),
        r.job.views30d, r.job.replies30d, round(r.replyRate),
        round(r.percentile.competition), round(r.percentile.volume), round(r.percentile.interest),
        r.recruiter.activity, r.recruiter.lastResponseAt?.toISOString() ?? "", r.recruiter.label,
        r.pool?.reportedExperience ?? "", round(r.pool?.experience5PlusShare ?? null),
        round(r.pool?.medianExperienceYears ?? null),
        r.pool?.englishTop ?? "", round(r.pool?.salaryMedianUsd ?? null),
        r.pool ? r.pool.topSkills.map((s) => `${s.name}:${s.count}`).join(";") : "",
        round(r.opportunityScore), r.flags.join(";"),
        r.job.applicantStats?.fetchedAt.toISOString() ?? "", r.job.detailCachedAt?.toISOString() ?? "",
      ].map(csvCell).join(","),
    );
  }

  await fs.mkdir(config.analysisDir, { recursive: true });
  const jsonPath = path.join(config.analysisDir, `${base}.json`);
  const csvPath = path.join(config.analysisDir, `${base}.csv`);
  await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.writeFile(csvPath, lines.join("\n"), "utf8");
  return { jsonPath, csvPath };
}

// ---------- Вспомогательные ----------

function recruiterCell(row: CompetitionRow): string {
  const activity = recruiterActivityRu(row.recruiter.activity);
  if (row.recruiter.daysSinceResponse !== null) {
    return `${activity}, ${daysAgoRu(row.recruiter.daysSinceResponse)}`;
  }
  return row.recruiter.activity === "UNKNOWN" ? "—" : activity;
}

function ageLabel(days: number): string {
  if (days < 1) return "<1 дн.";
  if (days > 365) return `${(days / 365).toFixed(1)} г.`;
  return `${Math.round(days)} дн.`;
}

function pctStr(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}
