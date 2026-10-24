// Перепарсинг кэшированных detail-HTML без сети: pnpm parse
// Полезно после изменений парсера/словаря — данные перечитываются из RAW_STORE
// (таблица RawHtmlPage в БД либо файлы cache/scrape/detail при RAW_STORE=fs).
import { prisma } from "../db.js";
import { parseDetailPage } from "./parse-detail.js";
import { extractJobSkills } from "../skills/extract.js";
import { updateJobFromDetail } from "../storage.js";
import { createRawStore } from "../storage/raw-store.js";
import { printVacancySummary } from "../scraper/scrape.js";
import { RunTracker } from "../runlog.js";
import { c, ce } from "../log.js";

async function main(): Promise<void> {
  const tracker = await RunTracker.start("PARSE_CACHED");
  const store = createRawStore();
  try {
    const keys = await store.listKeys("DETAIL");
    console.log(`[parse] найдено ${c.bold(String(keys.length))} кэшированных detail-страниц в ${c.cyan(`RAW_STORE=${process.env.RAW_STORE ?? "db"}`)}`);

    let skillsTotal = 0;
    for (const key of keys) {
      const jobId = Number.parseInt(key, 10);
      if (Number.isNaN(jobId)) continue;

      const html = await store.get("DETAIL", key);
      if (html === null) continue;
      const rawRef = await store.getRef("DETAIL", key);

      const detail = parseDetailPage(html, `https://djinni.co/jobs/${jobId}/`);
      if (!detail) {
        console.warn(`[parse] не разобран: ${ce.yellow(key)}`);
        continue;
      }

      await updateJobFromDetail(detail, rawRef);
      printVacancySummary(jobId, detail, "[parse]");
      const { resolved, unresolvedNames } = await extractJobSkills({
        jobId,
        structuredSkills: detail.skills.map((s) => ({
          name: s.name,
          yearsRequired: s.yearsRequired,
          source: s.source,
        })),
        description: detail.description,
      });
      skillsTotal += resolved.length;
      tracker.countSkillsLinked(resolved.length);
      if (unresolvedNames.length > 0) {
        console.log(
          `[parse] ${c.bold(String(jobId))}: ${c.yellow("нераспознаны")}: ` +
            c.yellow(unresolvedNames.join(", ")),
        );
      }
    }

    console.log(
      `[parse] готово: ${c.bold(String(keys.length))} вакансий, ` +
        `${c.bold(String(skillsTotal))} связей навыков`,
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
  console.error(ce.red("[parse] фатальная ошибка:"), err);
  process.exit(1);
});
