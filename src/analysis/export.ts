// Аналитическое представление данных: экспорт снапшотов.
// pnpm export            — все вакансии
// pnpm export -- --window 30 — только за последние N дней (по datePosted)
// pnpm export -- --include-unresolved — включить неканонические навыки (по умолчанию исключены)
//
// Форматы:
// - snapshot-<date>.json — метаданные + вакансии с навыками (для приложения/дальнейших пайплайнов);
// - snapshot-<date>.csv  — long-format: одна строка = вакансия×навык (pandas/кластеризация/LLM).
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { RunTracker } from "../runlog.js";
import { csvCell } from "./csv.js";
import { c, ce } from "../log.js";

function arg(name: string): number | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  const n = Number.parseInt(process.argv[idx + 1], 10);
  return Number.isNaN(n) ? null : n;
}

async function main(): Promise<void> {
  const windowDays = arg("window");
  const includeUnresolved = process.argv.includes("--include-unresolved");
  const tracker = await RunTracker.start("ANALYSIS_EXPORT");

  try {
    const since = windowDays ? new Date(Date.now() - windowDays * 86_400_000) : null;

    const jobs = await prisma.jobPosting.findMany({
      where: {
        status: "ACTIVE",
        ...(since ? { datePosted: { gte: since } } : {}),
      },
      include: {
        skills: {
          include: { skill: true },
        },
        applicantStats: true,
      },
      orderBy: { datePosted: "desc" },
    });

    const snapshot = {
      meta: {
        generatedAt: new Date().toISOString(),
        windowDays,
        jobCount: jobs.length,
        canonicalOnly: !includeUnresolved,
        source: "djinni.co",
      },
      jobs: jobs.map((job) => ({
        id: job.id,
        url: job.url,
        title: job.title,
        company: job.company,
        category: job.category,
        industry: job.industry,
        domain: job.domain,
        datePosted: job.datePosted?.toISOString() ?? null,
        updatedAtDjinni: job.updatedAtDjinni?.toISOString() ?? null,
        validThrough: job.validThrough?.toISOString() ?? null,
        experienceYears: job.experienceYears,
        englishLevel: job.englishLevel,
        workFormat: job.workFormat,
        location: job.location,
        countries: job.countries,
        salaryTier: job.salaryTier,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        // Сигналы конкуренции (см. specs/07-competition-signals.md):
        // поля detail-страницы + последний снапшот apply_stats, если он есть
        competition: {
          viewsCount: job.viewsCount,
          repliesCount: job.repliesCount,
          views30d: job.views30d,
          replies30d: job.replies30d,
          recruiterActivity: job.recruiterActivity,
          recruiterLastResponseAt: job.recruiterLastResponseAt?.toISOString() ?? null,
          recruiterResponseLabel: job.recruiterResponseLabel,
          applicants: job.applicantStats?.totalApplicants ?? null,
          statsFetchedAt: job.applicantStats?.fetchedAt.toISOString() ?? null,
        },
        skills: job.skills
          .filter((s) => includeUnresolved || s.skill.isCanonical) // неканонические — по --include-unresolved
          .map((s) => ({
            name: s.skill.name,
            category: s.skill.category,
            isCanonical: s.skill.isCanonical,
            source: s.source,
            isRequired: s.isRequired,
            yearsRequired: s.yearsRequired,
          })),
      })),
    };

    await fs.mkdir(config.analysisDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const suffix = windowDays ? `-w${windowDays}` : "";

    // JSON-снапшот (структурированное представление)
    const jsonPath = path.join(config.analysisDir, `snapshot-${date}${suffix}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");

    // CSV long-format: одна строка = вакансия × навык (для pandas/кластеризации/LLM)
    const csvPath = path.join(config.analysisDir, `snapshot-${date}${suffix}.csv`);
    const header = [
      "job_id", "url", "title", "company", "category", "industry", "domain",
      "date_posted", "experience_years", "english_level", "work_format",
      "location", "salary_tier", "salary_min", "salary_max", "salary_currency",
      "skill", "skill_category", "skill_is_canonical", "skill_source",
      "skill_is_required", "skill_years_required",
    ];
    const rows: string[] = [header.join(",")];
    for (const job of snapshot.jobs) {
      const base = [
        job.id, job.url, job.title, job.company, job.category, job.industry, job.domain,
        job.datePosted, job.experienceYears, job.englishLevel, job.workFormat,
        job.location, job.salaryTier, job.salaryMin, job.salaryMax, job.salaryCurrency,
      ];
      if (job.skills.length === 0) {
        rows.push([...base, "", "", "", "", "", ""].map(csvCell).join(","));
        continue;
      }
      for (const skill of job.skills) {
        rows.push(
          [...base, skill.name, skill.category, skill.isCanonical, skill.source, skill.isRequired, skill.yearsRequired]
            .map(csvCell)
            .join(","),
        );
      }
    }
    await fs.writeFile(csvPath, rows.join("\n"), "utf8");

    const skillCount = snapshot.jobs.reduce((acc, j) => acc + j.skills.length, 0);
    console.log(
      `[export] ${c.bold(String(snapshot.meta.jobCount))} вакансий, ` +
        `${c.bold(String(skillCount))} связей навыков\n` +
        `  JSON: ${c.cyan(jsonPath)}\n  CSV:  ${c.cyan(csvPath)}`,
    );
    await tracker.finish();
  } catch (err) {
    await tracker.finish(err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(ce.red("[export] фатальная ошибка:"), err);
  process.exit(1);
});
