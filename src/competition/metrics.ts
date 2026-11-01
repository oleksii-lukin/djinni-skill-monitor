// Метрики конкуренции по вакансии: абсолютные значения + сравнение с рынком.
//
// Рынок (baseline) — ВСЕ активные вакансии, у которых есть снапшот apply_stats
// (не только текущая выборка): так «мало/много откликов» считается по рыночной
// базе, а не по произвольно отобранному шортлисту.
//
// Три источника сигналов:
// - apply_stats (снапшот JobApplicantStats): total_applicants + распределения кандидатов;
// - detail-страница (поля JobPosting): просмотры/отклики за 30 дней и за всё время,
//   активность рекрутера и момент последнего ответа;
// - даты: datePosted / updatedAtDjinni — «свежесть» вакансии.
import type { JobApplicantStats, JobPosting, RecruiterActivity } from "@prisma/client";
import type { ApplicantSkill, ApplicantStats, DistributionItem } from "./parse-applicant-stats.js";

const DAY_MS = 86_400_000;

/** Ниже этого n перцентили/флаги конкуренции не считаются — выборка слишком мала. */
export const MIN_BASELINE_N = 10;

export interface Quantiles {
  p25: number;
  median: number;
  p75: number;
  p90: number;
}

export interface CompetitionBaseline {
  n: number;
  appsPerDay: Quantiles;
  totalApplicants: Quantiles;
  replyRate: Quantiles;
  /** Возраст снапшотов baseline в днях (медиана) — насколько свежа рыночная база. */
  statsAgeDays: number;
}

export interface CompetitionJob {
  job: JobPosting & { applicantStats: JobApplicantStats | null };
  ageDays: number; // от публикации — для lifetime-темпа
  lastActivityAt: Date; // max(datePosted, updatedAtDjinni) — для свежести
  totalApplicants: number | null;
  appsPerDay: number | null; // откликнов/день: 30-дневный темп, иначе lifetime
  lifetimeAppsPerDay: number | null;
  recentAppsPerDay: number | null;
  replyRate: number | null; // отклики / просмотры
  pool: ApplicantPool | null;
  statsAgeDays: number | null;
  detailAgeDays: number | null;
}

export interface CompetitionRow extends CompetitionJob {
  /** Дней с последнего «подъёма» вакансии (max(datePosted, updatedAtDjinni)) — свежесть. */
  daysSinceActivity: number;
  percentile: {
    competition: number | null;
    volume: number | null;
    interest: number | null;
  };
  recruiter: {
    activity: RecruiterActivity;
    lastResponseAt: Date | null;
    daysSinceResponse: number | null;
    label: string | null; // сырая djinni-подпись («Відповідали вчора»)
  };
  flags: string[];
  opportunityScore: number | null;
}

/** Профиль откликнувшихся: опыт, English, зарплатные ожидания, топ-навыки. */
export interface ApplicantPool {
  reportedExperience: number; // сколько кандидатов указали опыт
  experience5PlusShare: number | null; // доля 5+ лет среди указавших
  medianExperienceYears: number | null;
  englishTop: string | null; // самый частый уровень
  englishReported: number;
  salaryMedianUsd: number | null; // медиана mid-точек вилок ожиданий
  salaryReported: number;
  topSkills: ApplicantSkill[]; // топ-5
}

// ---------- Базовые парсеры-нормализаторы ----------

export interface ExperienceBucket {
  minYears: number;
  maxYears: number | null;
}

/** Бакеты опыта djinni: «< 1 року», «1-2 роки», «3-5 років», «10+ років». */
export function experienceBucket(label: string): ExperienceBucket | null {
  // Метки с украинскими суффиксами («5-10 років», «10+ років») — оставляем только числа/знаки
  const t = label.replace(/[^\d<>+-]/g, "");
  let m = t.match(/^<(\d+)/);
  if (m) return { minYears: 0, maxYears: Number(m[1]) };
  m = t.match(/^(\d+)\+$/);
  if (m) return { minYears: Number(m[1]), maxYears: null };
  m = t.match(/^(\d+)-(\d+)$/);
  if (m) return { minYears: Number(m[1]), maxYears: Number(m[2]) };
  return null;
}

/** Ранг уровня English: A1=1 … C2=6, «Носій мови»=7. */
export function englishRank(label: string): number | null {
  const t = label.trim();
  const ranks: Record<string, number> = {
    A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, ADVANCED: 6,
  };
  const up = t.toUpperCase();
  if (up in ranks) return ranks[up];
  if (/носій|native/i.test(t)) return 7;
  if (/просунутий|advanced/i.test(t)) return 6;
  return null;
}

/** Зарплатные ожидания djinni: «<$2700», «$2700-3800», «$1200+», «$300-600». */
export function salaryRange(label: string): { min: number; max: number } | null {
  const t = label.replace(/\s/g, "");
  let m = t.match(/^<\$(\d+)$/);
  if (m) return { min: 0, max: Number(m[1]) };
  m = t.match(/^\$?(\d+)-\$?(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = t.match(/^\$?(\d+)\+$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  m = t.match(/^>\$(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

export function sumCounts(items: DistributionItem[]): number {
  return items.reduce((acc, i) => acc + i.count, 0);
}

// ---------- Профиль откликнувшихся ----------

export function computeApplicantPool(stats: ApplicantStats): ApplicantPool | null {
  const expSum = sumCounts(stats.experience);
  const experienceEntries = stats.experience.map((item) => {
    const bucket = experienceBucket(item.label);
    if (!bucket) return null;
    // Точка-представитель бакета: середина; «10+» → 12, «<1» → 0.5
    const mid =
      bucket.maxYears === null ? bucket.minYears + 2 : (bucket.minYears + bucket.maxYears) / 2;
    return { weight: item.count, value: mid };
  }).filter((e): e is { weight: number; value: number } => e !== null);

  const overFive = stats.experience
    .filter((item) => {
      const b = experienceBucket(item.label);
      return b !== null && (b.maxYears === null || b.maxYears > 5) && (b.minYears ?? 0) >= 5;
    })
    .reduce((acc, i) => acc + i.count, 0);

  const salaryEntries = stats.salary.map((item) => {
    const r = salaryRange(item.label);
    if (!r) return null;
    return { weight: item.count, value: (r.min + r.max) / 2 };
  }).filter((e): e is { weight: number; value: number } => e !== null);

  const englishTop = [...stats.english].sort((a, b) => b.count - a.count)[0]?.label ?? null;

  return {
    reportedExperience: expSum,
    experience5PlusShare: expSum > 0 ? overFive / expSum : null,
    medianExperienceYears: weightedMedian(experienceEntries),
    englishTop,
    englishReported: sumCounts(stats.english),
    salaryMedianUsd: weightedMedian(salaryEntries),
    salaryReported: sumCounts(stats.salary),
    topSkills: [...stats.topSkills].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

// ---------- Baseline ----------

export interface BaselineInput {
  totalApplicants: number;
  appsPerDay: number;
  replyRate: number | null;
  statsAgeDays: number;
}

export function computeBaseline(inputs: BaselineInput[]): CompetitionBaseline {
  const appsPerDay = inputs.map((i) => i.appsPerDay);
  const totals = inputs.map((i) => i.totalApplicants);
  const rates = inputs.map((i) => i.replyRate).filter((r): r is number => r !== null);
  const statsAges = inputs.map((i) => i.statsAgeDays);

  return {
    n: inputs.length,
    appsPerDay: {
      p25: quantile(appsPerDay, 0.25),
      median: quantile(appsPerDay, 0.5),
      p75: quantile(appsPerDay, 0.75),
      p90: quantile(appsPerDay, 0.9),
    },
    totalApplicants: {
      p25: quantile(totals, 0.25),
      median: quantile(totals, 0.5),
      p75: quantile(totals, 0.75),
      p90: quantile(totals, 0.9),
    },
    replyRate: {
      p25: quantile(rates, 0.25),
      median: quantile(rates, 0.5),
      p75: quantile(rates, 0.75),
      p90: quantile(rates, 0.9),
    },
    statsAgeDays: quantile(statsAges, 0.5),
  };
}

/** Перцентиль значения x в выборке values (доля значений ≤ x). */
export function percentileRank(values: number[], x: number): number {
  let below = 0;
  for (const v of values) if (v <= x) below++;
  return below / values.length;
}

// ---------- Метрики вакансии ----------

export function computeCompetitionJob(
  job: JobPosting & { applicantStats: JobApplicantStats | null },
  now = new Date(),
): CompetitionJob {
  const postedAt = job.datePosted ?? job.createdAt;
  const lastActivityAt = new Date(
    Math.max(job.datePosted?.getTime() ?? 0, job.updatedAtDjinni?.getTime() ?? 0) ||
      job.createdAt.getTime(),
  );
  const ageDays = Math.max(0.5, (now.getTime() - postedAt.getTime()) / DAY_MS);

  const stats = job.applicantStats;
  const totalApplicants = stats?.totalApplicants ?? null;
  const lifetimeAppsPerDay = totalApplicants === null ? null : totalApplicants / ageDays;
  const recentAppsPerDay = job.replies30d === null ? null : job.replies30d / 30;
  // Темп: 30-дневный предпочтительнее (не смешивает старые и новые отклики),
  // иначе lifetime (свежие вакансии моложе 30 дней).
  const appsPerDay = recentAppsPerDay ?? lifetimeAppsPerDay;

  const replyRate =
    job.views30d !== null && job.replies30d !== null && job.views30d > 0
      ? job.replies30d / job.views30d
      : job.viewsCount !== null && job.repliesCount !== null && job.viewsCount > 0
        ? job.repliesCount / job.viewsCount
        : null;

  return {
    job,
    ageDays,
    lastActivityAt,
    totalApplicants,
    appsPerDay,
    lifetimeAppsPerDay,
    recentAppsPerDay,
    replyRate,
    pool: stats ? computeApplicantPool(parseStatsJson(stats)) : null,
    // Снапшот мог быть создан в этот же прогон — не показываем отрицательный возраст
    statsAgeDays: stats ? Math.max(0, (now.getTime() - stats.fetchedAt.getTime()) / DAY_MS) : null,
    detailAgeDays: job.detailCachedAt ? (now.getTime() - job.detailCachedAt.getTime()) / DAY_MS : null,
  };
}

/** Обогащение метрик baseline-перцентилями, флагами и score. */
export function decorateRow(
  base: CompetitionJob,
  baseline: CompetitionBaseline,
  values: { appsPerDay: number[]; totals: number[]; replyRates: number[] },
  now = new Date(),
): CompetitionRow {
  const daysSinceResponse =
    base.job.recruiterLastResponseAt === null
      ? null
      : (now.getTime() - base.job.recruiterLastResponseAt.getTime()) / DAY_MS;

  const useBaseline = baseline.n >= MIN_BASELINE_N;
  const competition =
    useBaseline && base.appsPerDay !== null
      ? percentileRank(values.appsPerDay, base.appsPerDay)
      : null;
  const volume =
    useBaseline && base.totalApplicants !== null
      ? percentileRank(values.totals, base.totalApplicants)
      : null;
  const interest =
    useBaseline && base.replyRate !== null ? percentileRank(values.replyRates, base.replyRate) : null;

  const ageSinceActivity = (now.getTime() - base.lastActivityAt.getTime()) / DAY_MS;
  const freshness = clamp01(1 - ageSinceActivity / 30);
  const recruiterScore = activityScore(base.job.recruiterActivity);

  const flags = buildFlags({ base, competition, interest, daysSinceResponse, ageSinceActivity, now });

  const opportunityScore =
    competition === null
      ? null
      : 0.4 * (1 - competition) +
        0.25 * freshness +
        0.2 * recruiterScore +
        0.15 * (1 - (volume ?? 0.5));

  return {
    ...base,
    daysSinceActivity: ageSinceActivity,
    percentile: { competition, volume, interest },
    recruiter: {
      activity: base.job.recruiterActivity,
      lastResponseAt: base.job.recruiterLastResponseAt,
      daysSinceResponse,
      label: base.job.recruiterResponseLabel,
    },
    flags,
    opportunityScore,
  };
}

// ---------- Флаги ----------

interface FlagInput {
  base: CompetitionJob;
  competition: number | null;
  interest: number | null;
  daysSinceResponse: number | null;
  ageSinceActivity: number;
  now: Date;
}

export function buildFlags(i: FlagInput): string[] {
  const flags: string[] = [];
  const { base } = i;
  const activity = base.job.recruiterActivity;
  const ageDays = i.ageSinceActivity;

  if (base.totalApplicants === 0) flags.push("zero-applicants");
  if (base.totalApplicants === null) {
    // Нет apply_stats: если и detail-страница ничего не дала — данных нет вообще,
    // иначе остаются сигналы страницы (просмотры/отклики/30-дневная разбивка).
    const noPageStats =
      base.job.viewsCount === null &&
      base.job.repliesCount === null &&
      base.job.replies30d === null;
    flags.push(noPageStats ? "no-data" : "no-apply-stats");
  }

  if (i.competition !== null) {
    if (i.competition <= 0.25 && base.ageDays >= 3) flags.push("low-competition");
    if (i.competition >= 0.75) flags.push("high-competition");
  }
  if (i.interest !== null && i.interest >= 0.75 && (base.job.replies30d ?? 0) >= 3) {
    flags.push("high-interest");
  }

  if (ageDays <= 3) flags.push("fresh");
  if (ageDays > 21) flags.push("stale-listing");

  // Рекрутер: одна взаимоисключающая оценка. Быстрый ответ (≤7 дней) важнее
  // общей активности: «низкая активность + ответил 3 дня назад» = responsive.
  const daysSince = i.daysSinceResponse;
  const quickResponse = daysSince !== null && daysSince <= 7;
  const staleResponse = daysSince !== null && daysSince > 30;
  const responsive = quickResponse || activity === "VERY_HIGH" || activity === "HIGH";
  const silent = !responsive && (staleResponse || activity === "LOW");
  if (responsive) flags.push("responsive-recruiter");
  if (silent) flags.push("silent-recruiter");

  if ((base.pool?.experience5PlusShare ?? 0) >= 0.5 && (base.pool?.reportedExperience ?? 0) >= 5) {
    flags.push("experienced-pool");
  }
  if (base.statsAgeDays !== null && base.statsAgeDays > 2 * 24) flags.push("stats-stale");

  return flags;
}

// ---------- Вспомогательные ----------

function activityScore(activity: RecruiterActivity): number {
  switch (activity) {
    case "VERY_HIGH":
      return 1;
    case "HIGH":
      return 0.75;
    case "MEDIUM":
      return 0.5;
    case "LOW":
      return 0.25;
    default:
      return 0.5; // UNKNOWN — нейтрально
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function weightedMedian(entries: { weight: number; value: number }[]): number | null {
  const sorted = entries.filter((e) => e.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((acc, e) => acc + e.weight, 0);
  if (total === 0) return null;
  let acc = 0;
  for (const e of sorted) {
    acc += e.weight;
    if (acc >= total / 2) return e.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

// JobApplicantStats хранит JSON-поля как есть — разворачиваем в типизированный вид
function parseStatsJson(stats: JobApplicantStats): ApplicantStats {
  return {
    totalApplicants: stats.totalApplicants,
    experience: stats.experienceDist as unknown as DistributionItem[],
    salary: stats.salaryDist as unknown as DistributionItem[],
    english: stats.englishDist as unknown as DistributionItem[],
    topSkills: stats.topSkills as unknown as ApplicantSkill[],
  };
}
