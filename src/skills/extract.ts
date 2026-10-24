// Разрешение имён навыков → записи Skill в БД (upsert по canonical-имени).
// Приоритет источников: DJINNI_STRUCTURED > DJINNI_EXTRA > DESCRIPTION_KEYWORD.
import type { SkillCategory, SkillSource } from "@prisma/client";
import { prisma } from "../db.js";
import { buildSkillLookup, normalizeSkillKey, type SkillDictEntry } from "./dictionary.js";

const lookup = buildSkillLookup();

export interface ResolvedSkill {
  skillId: number;
  name: string;
  category: SkillCategory;
  source: SkillSource;
  isRequired: boolean;
  yearsRequired: number | null;
  rawName: string;
  canonical: boolean; // разрешено словарём (true) или авто-создано (false)
}

// Кэш skillId по canonical-имени, чтобы не дёргать БД на каждый навык
const skillIdCache = new Map<string, number>();

export function matchSkill(rawName: string): SkillDictEntry | null {
  return lookup.get(normalizeSkillKey(rawName)) ?? null;
}

/**
 * Разрешить навык: словарь → canonical; иначе авто-создать Skill(isCanonical=false).
 * Авто-созданные имена попадают в отчёт unresolved для курации словаря.
 */
export async function resolveSkill(rawName: string): Promise<{
  skillId: number;
  name: string;
  category: SkillCategory;
  canonical: boolean;
} | null> {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.length > 60) return null;

  const matched = matchSkill(trimmed);
  const name = matched ? matched.name : trimmed;
  const category: SkillCategory = matched ? matched.category : "OTHER";
  const canonical = matched !== null;

  const cached = skillIdCache.get(name.toLowerCase());
  if (cached !== undefined) return { skillId: cached, name, category, canonical };

  const skill = await prisma.skill.upsert({
    where: { name },
    create: { name, category, isCanonical: canonical, aliases: [] },
    update: {},
  });
  skillIdCache.set(name.toLowerCase(), skill.id);
  return { skillId: skill.id, name, category, canonical };
}

/**
 * Полное извлечение навыков вакансии: структурированные djinni-навыки + навыки из
 * текста описания по словарю (keyword-слой). Дедупликация с приоритетом источника.
 */
export async function extractJobSkills(input: {
  jobId: number;
  structuredSkills: { name: string; yearsRequired: number | null; source: SkillSource }[];
  description: string | null;
}): Promise<{ resolved: ResolvedSkill[]; unresolvedNames: string[] }> {
  const bySkillId = new Map<number, ResolvedSkill>();
  const unresolvedNames: string[] = [];

  const sourcePriority: Record<SkillSource, number> = {
    DJINNI_STRUCTURED: 3,
    DJINNI_EXTRA: 2,
    DESCRIPTION_KEYWORD: 1,
  };

  const add = async (
    rawName: string,
    source: SkillSource,
    yearsRequired: number | null,
  ): Promise<void> => {
    const resolved = await resolveSkill(rawName);
    if (!resolved) return;
    if (!resolved.canonical && source === "DESCRIPTION_KEYWORD") {
      // keyword-слой не создаёт новых канонических навыков — только словарные имена
      return;
    }
    if (!resolved.canonical) unresolvedNames.push(rawName);

    const existing = bySkillId.get(resolved.skillId);
    if (existing && sourcePriority[existing.source] >= sourcePriority[source]) return;

    bySkillId.set(resolved.skillId, {
      ...resolved,
      source,
      isRequired: source === "DJINNI_STRUCTURED",
      yearsRequired: yearsRequired ?? existing?.yearsRequired ?? null,
      rawName,
    });
  };

  // 1-2: djinni-навыки (structured + extra) — must-have / nice-to-have
  for (const skill of input.structuredSkills) {
    await add(skill.name, skill.source, skill.yearsRequired);
  }

  // 3: keyword-слой по описанию — только навыки из словаря, ещё не найденные
  if (input.description) {
    const descLower = input.description.toLowerCase();
    for (const entry of dictionaryValues()) {
      const already = [...bySkillId.values()].some((r) => r.name === entry.name);
      if (already) continue;
      if (keywordHit(descLower, entry)) {
        await add(entry.name, "DESCRIPTION_KEYWORD", null);
      }
    }
  }

  const resolved = [...bySkillId.values()];

  // Персист в БД: заменить все требования вакансии (идемпотентный re-parse)
  await prisma.jobSkillRequirement.deleteMany({ where: { jobId: input.jobId } });
  if (resolved.length > 0) {
    await prisma.jobSkillRequirement.createMany({
      data: resolved.map((r) => ({
        jobId: input.jobId,
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

function dictionaryValues(): SkillDictEntry[] {
  // дешёвый способ пройтись по словарю: из lookup-ключи не нужны, нужен сам вход
  return [...new Set(lookup.values())];
}

/**
 * Keyword-поиск по тексту: границы слов для латиницы; для кириллицы/спецсимволов
 * (#, +, .) — проверка соседних символов вручную. Описания EN/UA.
 */
function keywordHit(descLower: string, entry: SkillDictEntry): boolean {
  const terms = [entry.name, ...entry.aliases];
  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.length < 3 && !/[#+.]/.test(t)) continue; // слишком короткие — много ложных срабатываний
    if (hasWordBoundary(descLower, t)) return true;
  }
  return false;
}

function hasWordBoundary(text: string, term: string): boolean {
  let idx = text.indexOf(term);
  while (idx !== -1) {
    const before = idx === 0 ? "" : text[idx - 1];
    const afterIdx = idx + term.length;
    const after = afterIdx >= text.length ? "" : text[afterIdx];
    const wordChar = /[\p{L}\p{N}]/u;
    if (!wordChar.test(before) && !wordChar.test(after)) return true;
    idx = text.indexOf(term, idx + 1);
  }
  return false;
}
