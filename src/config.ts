// Единая конфигурация пайплайна: значения из env с безопасными дефолтами.
import "dotenv/config";

function intEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) throw new Error(`Некорректный ${name}: ${v}`);
  return n;
}

// Дефолтный набор категорий фильтра «Розробка» (ключи djinni primary_keyword).
// Соответствует выбору в UI: JavaScript / Front-End (все дочерние), Fullstack,
// Node.js, No Code, React Native — без фильтра даёт ~6135 вакансий, с ним ~256.
const DEFAULT_FILTER_KEYWORDS = [
  "JavaScript",
  "Angular",
  "Markup",
  "React.js",
  "Svelte",
  "Vue.js",
  "Fullstack",
  "Node.js",
  "No Code",
  "React Native",
];

function listEnv(name: string, def: string[]): string[] {
  const v = process.env[name];
  if (v === undefined) return def;
  if (v.trim() === "" || v.trim().toLowerCase() === "none") return []; // пусто/"none" — без фильтра
  const list = v.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (list.length === 0) throw new Error(`Некорректный ${name}: ${v}`); // напр. «,,,»
  return list;
}

function boolEnv(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  if (v === "1" || v.toLowerCase() === "true") return true;
  if (v === "0" || v.toLowerCase() === "false") return false;
  throw new Error(`Некорректный ${name}: ${v} (ожидается 0/1)`);
}

export const config = {
  baseUrl: "https://djinni.co",

  // Скрейп: большая защита от перегрузки (решение 2026-10-24; обновлено: случайный интервал)
  // Пауза перед каждым запросом — равномерно случайная из [delayMinMs, delayMaxMs].
  delayMinMs: intEnv("SCRAPE_DELAY_MIN_MS", 3000), // нижняя граница паузы
  delayMaxMs: intEnv("SCRAPE_DELAY_MAX_MS", 8000), // верхняя граница паузы
  timeoutMs: intEnv("SCRAPE_TIMEOUT_MS", 30000),
  maxRetries: intEnv("SCRAPE_MAX_RETRIES", 5),

  // Дефолтные лимиты одного запуска (CLI переопределяет)
  defaultPages: intEnv("SCRAPE_DEFAULT_PAGES", 5), // страниц списка за запуск
  defaultVacancies: intEnv("SCRAPE_DEFAULT_VACANCIES", 5), // detail-страниц за запуск

  // Фильтр списка: категории «Розробка» через повторяющиеся primary_keyword (GET).
  // Дефолт — набор из DEFAULT_FILTER_KEYWORDS; "none"/пусто в env — без фильтра.
  filter: {
    primaryKeywords: listEnv("FILTER_PRIMARY_KEYWORDS", DEFAULT_FILTER_KEYWORDS),
  },

  // TTL кэша
  listTtlDays: intEnv("LIST_TTL_DAYS", 1), // список валиден 1 день, инвалидирует все страницы
  detailTtlDays: intEnv("DETAIL_TTL_DAYS", 7), // детали 7 дней либо до изменения updatedAtDjinni

  // Статистика конкуренции (pnpm competition, снапшот apply_stats на вакансию)
  competition: {
    ttlHours: intEnv("COMPETITION_TTL_HOURS", 24), // снапшот старше — качаем заново
    defaultLimit: intEnv("COMPETITION_DEFAULT_LIMIT", 20), // размер шортлиста за прогон
    defaultWindowDays: intEnv("COMPETITION_WINDOW_DAYS", 30), // окно «актуальности» вакансий
  },

  userAgent:
    process.env.SCRAPE_USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/126.0 Safari/537.36 SkillRadar/0.1 (+github.com/llamerr/djinni-skill-monitor)",

  cacheDir: "cache/scrape", // сырой HTML: cache/scrape/{list,detail}/… (RAW_STORE=fs)
  analysisDir: "cache/analysis", // экспорт аналитических снапшотов

  // Сторедж сырого HTML: db — таблица RawHtmlPage (общий кэш), fs — файлы (фолбэк)
  rawStore: (process.env.RAW_STORE === "fs" ? "fs" : "db") as "db" | "fs",

  // LLM-слой экстракции (ADR 0002): один OpenAI-совместимый фасад —
  // OpenCode Zen (https://opencode.ai/zen/v1), OpenRouter, OpenAI, Gemini
  // (OpenAI-compat) или локальный LM Studio (http://localhost:1234/v1).
  llm: {
    enabled: boolEnv("LLM_ENABLED", false), // выключен по умолчанию: без ключа всё работает как раньше
    baseUrl: process.env.LLM_BASE_URL ?? "https://opencode.ai/zen/v1",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "deepseek-v4-flash-free",
    threshold: intEnv("LLM_EXTRACT_THRESHOLD", 1), // вызывать LLM, если после 3 слоёв навыков < N
    concurrency: intEnv("LLM_CONCURRENCY", 3), // параллельные LLM-запросы (2–4)
    maxAttempts: intEnv("LLM_MAX_ATTEMPTS", 2), // попыток на одну вакансию (сеть/невалидный JSON)
    timeoutMs: intEnv("LLM_TIMEOUT_MS", 60_000),
    maxDescriptionChars: intEnv("LLM_MAX_DESC_CHARS", 8000), // усечение описания в промпт
    // true → response_format json_schema (так принимает LM Studio);
    // false → json_object (нужно некоторым шлюзам: Zen/OpenRouter/старые OpenAI-совместимые)
    structuredOutputs: boolEnv("LLM_STRUCTURED_OUTPUTS", true),
  },
} as const;

if (config.llm.enabled && config.llm.apiKey === "") {
  throw new Error(
    "LLM_ENABLED=1, но LLM_API_KEY пуст — создай ключ (opencode.ai/auth для Zen) " +
      "или укажи любую непустую строку для LM Studio",
  );
}

if (config.delayMaxMs < config.delayMinMs) {
  throw new Error(
    `SCRAPE_DELAY_MAX_MS (${config.delayMaxMs}) должен быть >= SCRAPE_DELAY_MIN_MS (${config.delayMinMs})`,
  );
}

/**
 * Случайная пауза перед запросом: равномерно в [delayMinMs, delayMaxMs] (мс).
 * Разброс интервалов маскирует скрейпер под нерегулярный трафик лучше фиксированной паузы.
 */
export function randomDelayMs(): number {
  const { delayMinMs, delayMaxMs } = config;
  return delayMinMs + Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1));
}
