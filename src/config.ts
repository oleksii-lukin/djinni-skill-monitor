// Единая конфигурация пайплайна: значения из env с безопасными дефолтами.
import "dotenv/config";

function intEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) throw new Error(`Некорректный ${name}: ${v}`);
  return n;
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

  // TTL кэша
  listTtlDays: intEnv("LIST_TTL_DAYS", 1), // список валиден 1 день, инвалидирует все страницы
  detailTtlDays: intEnv("DETAIL_TTL_DAYS", 7), // детали 7 дней либо до изменения updatedAtDjinni

  userAgent:
    process.env.SCRAPE_USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/126.0 Safari/537.36 SkillRadar/0.1 (+github.com/llamerr/djinni-skill-monitor)",

  cacheDir: "cache/scrape", // сырой HTML: cache/scrape/{list,detail}/… (RAW_STORE=fs)
  analysisDir: "cache/analysis", // экспорт аналитических снапшотов

  // Сторедж сырого HTML: db — таблица RawHtmlPage (общий кэш), fs — файлы (фолбэк)
  rawStore: (process.env.RAW_STORE === "fs" ? "fs" : "db") as "db" | "fs",
} as const;

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
