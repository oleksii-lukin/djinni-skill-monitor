// Публичный JSON статистики кандидатов djinni:
//   GET /api/jobs/<id>/?apply_stats
// Это тот же эндпоинт, который вызывает кнопка «Огляд кандидатів» на detail-странице
// (hx-get). Работает без авторизации и без cookies — проверено 2026-11-01.
//
// Важные оговорки про сами данные:
// - `percent` в распределениях djinni — нормировка на максимум, а НЕ доля:
//   у бакета с максимумом всегда 100; долю считаем сами как count / сумма(count);
// - суммы experience_dist / salary_dist могут быть меньше total_applicants
//   (не все кандидаты указали опыт/зарплатные ожидания); english_dist обычно полная;
// - `total_applicants` — текущее число откликнувшихся; в ответе есть служебные
//   флаги `is_candidate` / `candidate_has` (для залогиненного кандидата) — анонимно
//   всегда false, в БД они не сохраняются.
import { z } from "zod";
import { matchSkill } from "../skills/extract.js";

const distributionItemSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().nonnegative().optional(),
});

const topSkillSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
});

const applicantStatsSchema = z.object({
  total_applicants: z.number().int().nonnegative(),
  experience_dist: z.array(distributionItemSchema).default([]),
  salary_dist: z.array(distributionItemSchema).default([]),
  english_dist: z.array(distributionItemSchema).default([]),
  top_skills: z.array(topSkillSchema).default([]),
});

export interface DistributionItem {
  label: string;
  count: number;
  percent: number | null; // как есть, «нормировка на максимум» djinni
}

export interface ApplicantSkill {
  name: string; // сырое имя djinni
  count: number;
  canonicalName: string | null; // разрешено словарём (для сравнения с рынком/навыками вакансии)
}

export interface ApplicantStats {
  totalApplicants: number;
  experience: DistributionItem[];
  salary: DistributionItem[];
  english: DistributionItem[];
  topSkills: ApplicantSkill[];
}

/** Разобрать сырой ответ apply_stats; null — битый JSON или неожиданная схема. */
export function parseApplicantStats(raw: string): ApplicantStats | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = applicantStatsSchema.safeParse(json);
  if (!parsed.success) return null;

  const d = parsed.data;
  return {
    totalApplicants: d.total_applicants,
    experience: d.experience_dist.map(toItem),
    salary: d.salary_dist.map(toItem),
    english: d.english_dist.map(toItem),
    topSkills: d.top_skills.map((s) => ({
      name: s.name,
      count: s.count,
      canonicalName: matchSkill(s.name)?.name ?? null,
    })),
  };
}

/** URL эндпоинта статистики кандидатов (baseUrl — из config). */
export function applicantStatsUrl(baseUrl: string, jobId: number): string {
  return `${baseUrl}/api/jobs/${jobId}/?apply_stats`;
}

function toItem(i: z.infer<typeof distributionItemSchema>): DistributionItem {
  return { label: i.label, count: i.count, percent: i.percent ?? null };
}
