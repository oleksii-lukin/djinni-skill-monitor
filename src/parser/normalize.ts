// Нормализация сырых значений djinni → типизированные поля.
// Украиноязычные формы проверены на cache/research/*.html (2026-10-23).
import type { EnglishLevel, WorkFormat } from "@prisma/client";

/** Формат работы: «Тільки віддалено» / «Змішана» / «Офіс» (+ EN-варианты). */
export function parseWorkFormat(text: string): WorkFormat {
  const t = text.toLowerCase();
  if (/(тільки віддалено|віддалено|remote|fully remote|дистанційн)/.test(t)) return "REMOTE";
  if (/(змішан|hybrid|гибрид)/.test(t)) return "HYBRID";
  if (/(офіс|office)/.test(t)) return "OFFICE";
  return "UNKNOWN";
}

/** Уровень английского: A1–C2, «Просунутий»/«Advanced» → ADVANCED. */
export function parseEnglishLevel(text: string): EnglishLevel {
  // Сначала точные буквенные уровни (приоритет: они надёжнее описательных)
  const letter = text.match(/\b([ABC][12])\b/i);
  if (letter) return letter[1].toUpperCase() as EnglishLevel;

  const t = text.toLowerCase();
  if (/(просунутий|advanced|free\s*advantage)/.test(t)) return "ADVANCED";
  return "UNKNOWN";
}

/** Опыт в годах из строк вида «3 роки досвіду» / «від 10 років досвіду» / «2 роки». */
export function parseExperienceYears(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:рік|роки|років|року|рок|years?|yrs?)/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/** «3 роки» → 3.0; «1 рік» → 1.0; «6 місяців» → 0.5. */
export function parseYearsValue(text: string): number | null {
  const years = text.match(/(\d+(?:[.,]\d+)?)\s*(?:рік|роки|років|року|рок|years?|yrs?)/i);
  if (years) {
    const n = Number.parseFloat(years[1].replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  const months = text.match(/(\d+)\s*(?:місяц|month)/i);
  if (months) return Math.round((Number.parseInt(months[1], 10) / 12) * 10) / 10;
  // просто число (могут быть иные формы)
  const bare = text.match(/^(\d+(?:[.,]\d+)?)$/);
  if (bare) return Number.parseFloat(bare[1].replace(",", "."));
  return null;
}

/** HTML → плоский текст (для description и keyword-поиска). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&\w+;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const UA_MONTHS: Record<string, number> = {
  січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5,
  липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
  // Им. падежи на случай иных форм
  січень: 0, лютий: 1, березень: 2, квітень: 3, травень: 4, червень: 5,
  липень: 6, серпень: 7, вересень: 8, жовтень: 9, листопад: 10, грудень: 11,
};

/**
 * «Оновлено 23 жовтня» / «Опубліковано 22 вересня» → Date.
 * Год не указан: берём текущий; если дата в будущем — прошлый год.
 */
export function parseUkrainianDate(text: string): Date | null {
  const m = text.match(/(\d{1,2})\s+([а-яіїєґ]+)/i);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = UA_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;

  const now = new Date();
  let year = now.getFullYear();
  let date = new Date(year, month, day);
  if (date.getTime() > now.getTime()) {
    year -= 1;
    date = new Date(year, month, day);
  }
  return date;
}

/** «Країни Європи та Україна» / «Київ» → строка без нормализации (для отображения). */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Активность рекрутера: «Активність рекрутера: Висока» → HIGH.
 * djinni: Дуже висока / Висока / Середня / Низька; нераспознанное — UNKNOWN
 * (новые вакансии блоком не показывают вовсе).
 */
export type RecruiterActivityValue = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export function parseRecruiterActivity(text: string): RecruiterActivityValue {
  const t = cleanText(text).toLowerCase();
  if (/дуже\s+висок/.test(t)) return "VERY_HIGH";
  if (/висок/.test(t)) return "HIGH";
  if (/середн/.test(t)) return "MEDIUM";
  if (/низьк/.test(t)) return "LOW";
  return "UNKNOWN";
}

const UA_TZ = "Europe/Kyiv";

/**
 * Смещение таймзоны (мс) для момента `date` в зоне `timeZone`.
 * Нужен для корректного преобразования локального времени djinni («16:29 14.10.2026»)
 * в Date: летнее время в Киеве сдвигается дважды в год.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // Intl может отдавать 24 в полуночь
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * Точная подпись djinni «16:29 14.10.2026» (tooltip у «Відповідали …») → Date.
 * Интерпретируется как локальное время Europe/Kyiv. null при неверном формате.
 */
export function parseDjinniDateTime(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, hh, mm, day, month, year] = m;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm));
  let result = new Date(guess - tzOffsetMs(new Date(guess), UA_TZ));
  // На границе перевода времени смещение могло быть не тем — уточняем вторым проходом
  const refined = guess - tzOffsetMs(result, UA_TZ);
  if (refined !== result.getTime()) result = new Date(refined);
  return result;
}
