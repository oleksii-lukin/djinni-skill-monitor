// Цветной вывод для пайплайна: один словарь цветов на весь проект.
// Правила:
// - цвета только для TTY (pnpm scrape | tee log → чистый текст);
// - NO_COLOR=1 — выключить принудительно, FORCE_COLOR=1 — включить в пайпе;
// - stderr и stdout детектятся отдельно (console.warn/error vs log).

function colorEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR === "1") return false;
  if (process.env.FORCE_COLOR === "1") return true;
  return Boolean(stream.isTTY);
}

function wrap(stream: NodeJS.WriteStream, code: string, s: string): string {
  if (!colorEnabled(stream)) return s;
  return `\u001b[${code}m${s}\u001b[0m`;
}

const out = (code: string) => (s: string) => wrap(process.stdout, code, s);
const err = (code: string) => (s: string) => wrap(process.stderr, code, s);

// Цвета для stdout-вывода (console.log)
export const c = {
  /** голубой: даты публикации/обновления, слаги и пути */
  cyan: out("96"),
  /** успех: распознанные навыки, new=N, OK */
  green: out("32"),
  /** предупреждения, нераспознанные навыки */
  yellow: out("33"),
  /** ошибки, fatal */
  red: out("31"),
  /** заголовок вакансии (bright — читается на чёрном фоне) */
  magenta: out("95"),
  /** синий: URL и адреса (bright) */
  blue: out("94"),
  /** метаданные: TTL, пауза, run id */
  dim: out("90"),
  /** итоги и ключевая статистика */
  bold: out("1"),
};

// Цвета для stderr-вывода (console.warn / console.error)
export const ce = {
  cyan: err("36"),
  green: err("32"),
  yellow: err("33"),
  red: err("31"),
  dim: err("90"),
  bold: err("1"),
};

/** Поверх форматирования таблицы: padEnd должен быть внутри, цвет снаружи. */
export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
