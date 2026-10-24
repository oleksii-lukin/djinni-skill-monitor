// Rate-limited fetcher с защитой от перегрузки djinni.co:
// - пауза случайна из [delayMinMs, delayMaxMs] (по умолчанию 3–8 с) между ЛЮБЫМИ запросами;
// - exponential backoff на 429/403/5xx и сетевых ошибках (макс maxRetries);
// - честный User-Agent с контактной информацией;
// - подсчёт запросов для RunLog.
import { config, randomDelayMs } from "../config.js";
import { ce } from "../log.js";

export class RateLimitedFetcher {
  private lastRequestAt = 0;
  private requestCount = 0;

  constructor(
    private readonly onRequest?: () => void,
    // overrides.delayMs — фиксированная пауза (для тестов, без случайности)
    private readonly overrides?: { delayMs?: number; userAgent?: string },
  ) {}

  get requests(): number {
    return this.requestCount;
  }

  async fetch(url: string): Promise<string> {
    const fixedDelayMs = this.overrides?.delayMs;
    const userAgent = this.overrides?.userAgent ?? config.userAgent;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      await this.throttle(fixedDelayMs ?? randomDelayMs());

      this.requestCount++;
      this.onRequest?.();

      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(config.timeoutMs),
          redirect: "follow",
        });

        if (res.ok) {
          return await res.text();
        }

        // 429/403 — возможная блокировка; 5xx — серверная ошибка. Backoff.
        if (res.status === 429 || res.status === 403 || res.status >= 500) {
          const waitMs = backoffMs(attempt);
          console.warn(
            `[fetcher] HTTP ${ce.red(String(res.status))} для ${ce.blue(url)}; ` +
              `backoff ${ce.bold(`${Math.round(waitMs / 1000)}с`)} ${ce.dim(`(попытка ${attempt}/${config.maxRetries})`)}`,
          );
          await sleep(waitMs);
          continue;
        }

        // Прочие 4xx (вкл. 404) — не ретраим, ошибка клиента
        throw new HttpError(res.status, url);
      } catch (err) {
        // 4xx-ошибки (кроме 429/403 выше) не ретраим — вакансия могла удалиться
        if (err instanceof HttpError && err.status !== 429 && err.status !== 403) throw err;
        if (attempt === config.maxRetries) throw err;
        const waitMs = backoffMs(attempt);
        console.warn(
          `[fetcher] ошибка для ${ce.blue(url)}: ` +
            `${ce.red(err instanceof Error ? err.message : String(err))}; ` +
            `backoff ${ce.bold(`${Math.round(waitMs / 1000)}с`)} ${ce.dim(`(попытка ${attempt}/${config.maxRetries})`)}`,
        );
        await sleep(waitMs);
      }
    }

    throw new Error(`Не удалось получить ${url} за ${config.maxRetries} попыток`);
  }

  private async throttle(delayMs: number): Promise<void> {
    const waitUntil = this.lastRequestAt + delayMs;
    const now = Date.now();
    if (waitUntil > now) await sleep(waitUntil - now);
    this.lastRequestAt = Date.now();
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} для ${url}`);
    this.name = "HttpError";
  }
}

function backoffMs(attempt: number): number {
  // 10s, 20s, 40s, 80s, 160s — щадящий экспоненциальный backoff
  return Math.min(10_000 * 2 ** (attempt - 1), 160_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
