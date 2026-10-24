// Перепарсинг кэшированных detail-HTML без сети: pnpm parse
// Полезно после изменений парсера/словаря — данные перечитываются с диска.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { parseDetailPage } from "./parse-detail.js";
import { extractJobSkills } from "../skills/extract.js";
import { updateJobFromDetail } from "../storage.js";
import { RunTracker } from "../runlog.js";
import { c, ce } from "../log.js";

async function main(): Promise<void> {
  const tracker = await RunTracker.start("PARSE_CACHED");
  try {
    const dir = path.join(config.cacheDir, "detail");
    const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".html"));
    console.log(`[parse] найдено ${c.bold(String(files.length))} кэшированных detail-страниц в ${c.cyan(dir)}`);

    let skillsTotal = 0;
    for (const file of files) {
      const jobId = Number.parseInt(path.basename(file, ".html"), 10);
      if (Number.isNaN(jobId)) continue;

      const html = await fs.readFile(path.join(dir, file), "utf8");
      const detail = parseDetailPage(html, `https://djinni.co/jobs/${jobId}/`);
      if (!detail) {
        console.warn(`[parse] не разобран: ${ce.yellow(file)}`);
        continue;
      }

      await updateJobFromDetail(detail, path.join(dir, file));
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
      `[parse] готово: ${c.bold(String(files.length))} вакансий, ` +
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
