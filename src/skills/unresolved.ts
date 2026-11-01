// Классификация нераспознанных имён навыков для отчёта pnpm skills:unresolved.
// Чистые функции без БД: группировка вариантов, split составных меток,
// fuzzy-кандидаты (Левенштейн) и детект шума парсера («2 роки» и т.п.).
import {
  buildSkillLookup,
  normalizeSkillKey,
  skillDictionaryWithCuratedAliases,
  type SkillDictEntry,
} from "./dictionary.js";

export type Verdict = "alias" | "split" | "similar" | "new" | "noise";

export interface CandidateSuggestion {
  verdict: Verdict;
  /** Подсказка куратору: canonical-имя, «A + B», «возможно → X», «шум парсера». */
  suggestion: string;
}

/** Ключ группировки вариантов: без регистра, пробелов, точек, дефисов, подчёркиваний. */
export function suggestionKey(raw: string): string {
  return normalizeSkillKey(raw).replace(/[\s._\-]+/g, "");
}

/**
 * Loose-lookup словаря: suggestionKey(терма) → canonical-вход.
 * Ловит варианты написания, которые не покрыты строгим normalizeSkillKey
 * (точки/пробелы: «Nest.js» ↔ «NestJS»).
 */
export function buildLooseLookup(): Map<string, SkillDictEntry> {
  const lookup = new Map<string, SkillDictEntry>();
  for (const entry of skillDictionaryWithCuratedAliases()) {
    for (const term of [entry.name, ...entry.aliases]) {
      const key = suggestionKey(term);
      if (key && !lookup.has(key)) lookup.set(key, entry);
    }
  }
  return lookup;
}

// Строгий и loose-lookup строятся один раз на процесс (словарь статичен)
const strictLookup = buildSkillLookup();
const looseLookup = buildLooseLookup();

// Шум парсера: длительности из detail-rows__value и прочие не-навыки.
// \b не работает с кириллицей (ASCII word-chars) — используем negative lookahead по буквам.
const NOISE_PATTERNS: RegExp[] = [
  /^\d+\s*(рік|роки|років|року|місяц|місяці|місяців|місяця|годин|днів)(?![\p{L}])/iu,
  /^\d+$/,
];

export function isNoise(raw: string): boolean {
  const t = raw.trim();
  return NOISE_PATTERNS.some((p) => p.test(t));
}

/** Разбить составную метку: «Jira & Confluence», «C/C++», «PHP + MySQL». */
export function splitLabel(raw: string): string[] {
  return raw
    .split(/\s*[\/&]\s*|\s+\+\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Расстояние Левенштейна (итеративная матрица, без рекурсии). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Порог похожести: 1 опечатка для коротких ключей, 2 — для длинных (≥10). */
function similarThreshold(len: number): number {
  return Math.max(1, Math.floor(len / 5));
}

/** Ближайший словарный терм по suggestionKey, либо null. */
function findSimilar(raw: string): string | null {
  const key = suggestionKey(raw);
  if (key.length < 4) return null;

  let best: { name: string; dist: number } | null = null;
  for (const [termKey, entry] of looseLookup) {
    const dist = levenshtein(key, termKey);
    if (dist > similarThreshold(Math.max(key.length, termKey.length))) continue;
    if (best === null || dist < best.dist || (dist === best.dist && termKey.length < key.length)) {
      best = { name: entry.name, dist };
    }
  }
  return best?.name ?? null;
}

/**
 * Классифицировать нераспознанное имя: шум → алиас (строгий/loose) → составная
 * метка (все части резолвятся) → fuzzy-кандидат → новый навык.
 */
export function classifyCandidate(rawName: string): CandidateSuggestion {
  const trimmed = rawName.trim();
  if (isNoise(trimmed)) return { verdict: "noise", suggestion: "шум парсера — не навык" };

  const strict = strictLookup.get(normalizeSkillKey(trimmed));
  if (strict) return { verdict: "alias", suggestion: strict.name };

  const loose = looseLookup.get(suggestionKey(trimmed));
  if (loose) return { verdict: "alias", suggestion: loose.name };

  const parts = splitLabel(trimmed);
  if (parts.length >= 2) {
    const resolved = parts.map((p) => strictLookup.get(normalizeSkillKey(p)) ?? looseLookup.get(suggestionKey(p)) ?? null);
    if (resolved.every((r): r is SkillDictEntry => r !== null)) {
      const names = [...new Set(resolved.map((r) => r.name))];
      // Все части свелись к одному навыку («Google Sheets / Excel» → Excel) — это алиас
      if (names.length === 1) return { verdict: "alias", suggestion: names[0] };
      return { verdict: "split", suggestion: names.join(" + ") };
    }
  }

  const similar = findSimilar(trimmed);
  if (similar) return { verdict: "similar", suggestion: `возможно → ${similar}` };

  return { verdict: "new", suggestion: "новый навык — добавить в словарь" };
}

/** Русские метки вердиктов для консоли. */
export const VERDICT_LABELS: Record<Verdict, string> = {
  alias: "алиас",
  split: "составной",
  similar: "похоже",
  new: "новый",
  noise: "шум",
};

/** Короткие метки источников SkillSource для отчёта. */
export const SOURCE_LABELS: Record<string, string> = {
  DJINNI_STRUCTURED: "structured",
  DJINNI_EXTRA: "extra",
  DESCRIPTION_KEYWORD: "keyword",
  LLM_DESCRIPTION: "llm",
};
