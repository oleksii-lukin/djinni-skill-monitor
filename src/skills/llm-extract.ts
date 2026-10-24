// 4-й слой извлечения навыков: LLM по тексту описания (ADR 0002).
//
// Зачем: ~52% detail-страниц djinni не имеют блока «Навыки» — требования живут
// только в свободном тексте описания. Первые 3 слоя (structured/extra/keyword)
// для них дают 0 навыков → вызываем LLM (гейт needsLlmExtraction) и дополняем.
//
// Принципы:
// - детерминированные слои приоритетнее: LLM-навык не перезаписывает навык,
//   уже найденный structured/extra/keyword;
// - повторный запуск идемпотентен: перезаписываются только строки
//   с source=LLM_DESCRIPTION;
// - провайдер один на все бэкенды (OpenAI-совместимый фасад): OpenCode Zen,
//   OpenRouter, OpenAI, Gemini-compat, локальный LM Studio — всё через env;
// - вывод LLM проходит через словарь: canonical-имена разрешаются детерминированно,
//   неизвестные сохраняются как Skill(isCanonical=false) для курации.
import { Output, generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ce } from "../log.js";
import { SKILL_DICTIONARY } from "./dictionary.js";
import { resolveSkill, type ResolvedSkill } from "./extract.js";

// Схема структурированного вывода: валидация zod на стороне AI SDK
const llmSkillSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string().min(1).max(60),
      isRequired: z.boolean(),
    }),
  ),
});

const INSTRUCTIONS = [
  "You extract professional skills from an IT job vacancy (texts are mixed Ukrainian/Russian/English).",
  "Rules:",
  "- Extract ONLY skills, tools and technologies explicitly mentioned as required or preferred for the role.",
  "- Prefer names from the CANONICAL SKILLS list; use their exact spelling.",
  "- If a needed skill is absent from the list, keep its original wording (max 60 chars).",
  "- isRequired=true for must-have requirements, false for 'буде плюсом' / nice-to-have.",
  "- Never invent skills that the vacancy does not mention.",
  "- Output JSON only; the schema is enforced.",
].join("\n");

// Канонические имена словаря — в каждый промпт (единственный источник истины)
const CANONICAL_NAMES = SKILL_DICTIONARY.map((e) => e.name).join(", ");

function createModel() {
  const provider = createOpenAICompatible({
    name: "skill-extract",
    baseURL: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    supportsStructuredOutputs: config.llm.structuredOutputs,
  });
  return provider(config.llm.model);
}

let cachedModel: ReturnType<typeof createModel> | null = null;

export interface LlmExtractResult {
  skills: { name: string; isRequired: boolean }[];
  inputTokens: number;
  outputTokens: number;
}

/** Гейт: вызывать ли LLM, когда детерминированные слои дали меньше порога. */
export function needsLlmExtraction(currentSkillCount: number): boolean {
  return currentSkillCount < config.llm.threshold;
}

/**
 * Извлечь навыки из текста вакансии через LLM (структурированный вывод).
 * Ретраи по config.llm.maxAttempts: сеть/таймаут/невалидный JSON.
 */
export async function llmExtractSkills(input: {
  title: string;
  description: string;
}): Promise<LlmExtractResult> {
  const model = cachedModel ?? (cachedModel = createModel());

  const desc =
    input.description.length > config.llm.maxDescriptionChars
      ? `${input.description.slice(0, config.llm.maxDescriptionChars)}\n…[truncated]`
      : input.description;

  const prompt = [
    `CANONICAL SKILLS (preferred names): ${CANONICAL_NAMES}`,
    "",
    `VACANCY TITLE: ${input.title}`,
    "",
    "VACANCY DESCRIPTION:",
    desc,
  ].join("\n");

  let lastErr: unknown;
  for (let attempt = 1; attempt <= config.llm.maxAttempts; attempt++) {
    try {
      const result = await generateText({
        model,
        instructions: INSTRUCTIONS,
        prompt,
        output: Output.object({ schema: llmSkillSchema, name: "skills" }),
        temperature: 0,
        abortSignal: AbortSignal.timeout(config.llm.timeoutMs),
      });
      return {
        skills: result.output.skills,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < config.llm.maxAttempts) {
        const msg = err instanceof Error ? err.message : String(err);
        const body = (err as { responseBody?: string }).responseBody;
        const text = (err as { text?: string }).text; // NoObjectGeneratedError: что вернула модель
        console.warn(
          `[llm] попытка ${attempt}/${config.llm.maxAttempts} не удалась: ${ce.red(msg)}` +
            `${body ? ` — ${body.slice(0, 300)}` : ""}` +
            `${text ? ` — вывод модели: ${text.slice(0, 300)}` : ""} — повтор`,
        );
      }
    }
  }
  throw lastErr;
}

/**
 * Персист LLM-навыков вакансии: идемпотентная замена строк source=LLM_DESCRIPTION.
 * Совпадения с детерминированными слоями пропускаются; неизвестные словарю
 * имена создаются как Skill(isCanonical=false) и попадают в unresolvedNames.
 */
export async function applyLlmSkills(
  jobId: number,
  skills: { name: string; isRequired: boolean }[],
): Promise<{ resolved: ResolvedSkill[]; unresolvedNames: string[] }> {
  await prisma.jobSkillRequirement.deleteMany({
    where: { jobId, source: "LLM_DESCRIPTION" },
  });

  // Навыки, уже найденные детерминированными слоями, — не дублируем
  const linkedElsewhere = new Set(
    (
      await prisma.jobSkillRequirement.findMany({
        where: { jobId },
        select: { skillId: true },
      })
    ).map((r) => r.skillId),
  );

  const bySkillId = new Map<number, ResolvedSkill>();
  const unresolvedNames: string[] = [];

  for (const item of skills) {
    const resolved = await resolveSkill(item.name);
    if (!resolved) continue;
    if (linkedElsewhere.has(resolved.skillId) || bySkillId.has(resolved.skillId)) continue;
    if (!resolved.canonical) unresolvedNames.push(item.name);

    bySkillId.set(resolved.skillId, {
      ...resolved,
      source: "LLM_DESCRIPTION",
      isRequired: item.isRequired,
      yearsRequired: null,
      rawName: item.name,
    });
  }

  const resolved = [...bySkillId.values()];
  if (resolved.length > 0) {
    await prisma.jobSkillRequirement.createMany({
      data: resolved.map((r) => ({
        jobId,
        skillId: r.skillId,
        source: r.source,
        isRequired: r.isRequired,
        yearsRequired: r.yearsRequired,
        rawName: r.rawName,
      })),
      skipDuplicates: true,
    });
  }

  return { resolved, unresolvedNames };
}
