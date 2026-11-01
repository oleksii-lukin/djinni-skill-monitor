// LLM-экстракция навыков по кэшу detail-страниц: pnpm extract:llm [--limit N] [--job ID]
//
// Офлайн-проход без скрейпа (ADR 0002): читает RAW_STORE, прогоняет 3 детерминированных
// слоя, а при навыков < порога вызывает LLM и дополняет source=LLM_DESCRIPTION.
// Экономия: LLM трогает только вакансии-«нулевики» (гейт LLM_EXTRACT_THRESHOLD),
// лимит --limit ограничивает количество платных вызовов в прогоне.
import { prisma } from "../db.js";
import { config } from "../config.js";
import { parseDetailPage } from "../parser/parse-detail.js";
import { extractJobSkills } from "./extract.js";
import { applyLlmSkills, llmExtractSkills, needsLlmExtraction } from "./llm-extract.js";
import { updateJobFromDetail } from "../storage.js";
import { createRawStore } from "../storage/raw-store.js";
import { printUnresolvedHint } from "../scraper/scrape.js";
import { RunTracker } from "../runlog.js";
import { c, ce } from "../log.js";

function arg(name: string, def: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

const limitArg = arg("limit");
const llmLimit = limitArg === null ? Number.POSITIVE_INFINITY : Number.parseInt(limitArg, 10);
const jobArg = arg("job");
const onlyJobId = jobArg === null ? null : Number.parseInt(jobArg, 10);
if ((limitArg !== null && (Number.isNaN(llmLimit) || llmLimit < 0)) || (jobArg !== null && Number.isNaN(onlyJobId))) {
  console.error(ce.red("Некорректные аргументы:"), "--limit N (число) и --job ID (число)");
  process.exit(1);
}

async function main(): Promise<void> {
  if (!config.llm.enabled) {
    console.error(
      ce.red("[llm] LLM-слой выключен:"),
      "задай LLM_ENABLED=1 и LLM_API_KEY в .env (Zen: opencode.ai/auth, LM Studio: любая строка)",
    );
    process.exit(1);
  }

  console.log(
    `${c.dim("[llm]")} провайдер ${c.cyan(config.llm.baseUrl)} модель ${c.bold(config.llm.model)} ` +
      `порог=${config.llm.threshold} конкурентность=${config.llm.concurrency} ` +
      `лимит=${Number.isFinite(llmLimit) ? llmLimit : "∞"}`,
  );

  const tracker = await RunTracker.start("EXTRACT_LLM");
  try {
    const store = createRawStore();
    const keys = (await store.listKeys("DETAIL"))
      .map((k) => Number.parseInt(k, 10))
      .filter((id) => !Number.isNaN(id))
      .filter((id) => onlyJobId === null || id === onlyJobId);

    if (keys.length === 0) {
      console.warn(`[llm] ${ce.yellow("нет кэшированных detail-страниц")}${onlyJobId !== null ? ` для job ${onlyJobId}` : ""}`);
      await tracker.finish();
      return;
    }

    const before = await prisma.jobPosting.findMany({
      where: { id: { in: keys }, skills: { some: {} } },
      select: { id: true },
    });
    const zeroBefore = keys.length - before.length;
    console.log(`[llm] detail-страниц в проходе: ${c.bold(String(keys.length))} (без навыков до прохода: ${c.bold(String(zeroBefore))})`);

    const stats = { llmCalls: 0, llmSkills: 0, llmErrors: 0, inputTokens: 0, outputTokens: 0, noLlm: 0 };
    const unresolvedSeen = new Set<string>(); // имена за прогон — для итоговой подсказки
    let llmBudget = Number.isFinite(llmLimit) ? llmLimit : Number.MAX_SAFE_INTEGER;
    let nextIdx = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= keys.length || llmBudget <= 0) return;
        await processJob(keys[idx]);
      }
    };

    const processJob = async (jobId: number): Promise<void> => {
      const html = await store.get("DETAIL", String(jobId));
      if (html === null) return;
      const rawRef = await store.getRef("DETAIL", String(jobId));

      const detail = parseDetailPage(html, `${config.baseUrl}/jobs/${jobId}/`);
      if (!detail) {
        console.warn(`[llm] ${ce.yellow(String(jobId))}: detail-страница не разобрана`);
        return;
      }
      await updateJobFromDetail(detail, rawRef);

      // 1-3 слоя детерминированно (обновляет навыки по свежему словарю)
      const { resolved } = await extractJobSkills({
        jobId,
        structuredSkills: detail.skills.map((s) => ({
          name: s.name,
          yearsRequired: s.yearsRequired,
          source: s.source,
        })),
        description: detail.description,
      });

      if (!needsLlmExtraction(resolved.length)) {
        stats.noLlm++;
        return;
      }
      if (!detail.description) {
        console.log(`[llm] вакансия ${c.bold(String(jobId))}: ${c.yellow("нет описания")} — LLM невозможен`);
        return;
      }

      // Гейт бюджета: проверка + вычитание синхронно (single-threaded, без await между ними)
      if (llmBudget <= 0) return;
      llmBudget--;
      try {
        const { skills, inputTokens, outputTokens } = await llmExtractSkills({
          title: detail.title,
          description: detail.description,
        });
        const { resolved: llmResolved, unresolvedNames } = await applyLlmSkills(jobId, skills);

        stats.llmCalls++;
        stats.llmSkills += llmResolved.length;
        stats.inputTokens += inputTokens;
        stats.outputTokens += outputTokens;
        tracker.countRequest();
        tracker.countSkillsLinked(llmResolved.length);
        for (const n of unresolvedNames) unresolvedSeen.add(n);

        const names = llmResolved.map((r) => r.name).join(", ");
        const unresolved =
          unresolvedNames.length > 0
            ? ` ${c.yellow(`нераспознаны: ${unresolvedNames.join(", ")}`)}`
            : "";
        console.log(
          `[llm] вакансия ${c.bold(String(jobId))}: детерм. ${resolved.length}, ` +
            `LLM ${c.green(String(llmResolved.length))}${names ? c.green(` (${names})`) : ""}${unresolved}`,
        );
      } catch (err) {
        stats.llmErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        const body = (err as { responseBody?: string }).responseBody;
        console.warn(
          `[llm] вакансия ${ce.yellow(String(jobId))}: ${ce.red(msg)}` +
            `${body ? ` — ${ce.red(body.slice(0, 300))}` : ""}`,
        );
      }
    };

    const workers = Array.from({ length: Math.max(1, config.llm.concurrency) }, () => worker());
    await Promise.all(workers);

    const after = await prisma.jobPosting.findMany({
      where: { id: { in: keys }, skills: { some: {} } },
      select: { id: true },
    });
    const zeroAfter = keys.length - after.length;

    console.log(
      `\n${c.bold("[llm] итог:")} вызовов ${stats.llmCalls}, навыков через LLM ${c.green(String(stats.llmSkills))}, ` +
        `ошибок ${stats.llmErrors > 0 ? c.red(String(stats.llmErrors)) : "0"}, ` +
        `токенов in/out ${stats.inputTokens}/${stats.outputTokens}; без LLM (порог): ${stats.noLlm}`,
    );
    console.log(
      `[llm] вакансий без навыков: ${c.bold(String(zeroBefore))} → ${c.bold(c.green(String(zeroAfter)))}`,
    );
    printUnresolvedHint(unresolvedSeen, "[llm]");
    await tracker.finish();
  } catch (err) {
    await tracker.finish(err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(ce.red("[llm] фатальная ошибка:"), err);
  process.exit(1);
});
