// CLI скрейпера: pnpm scrape -- --pages 5 --vacancies 5 [--list-ttl-days 1] [--detail-ttl-days 7] [--keywords A,B|none] [--dry-run]
import { config } from "../config.js";
import { c, ce } from "../log.js";
import { runScrape } from "./scrape.js";

function arg(name: string, def: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  const n = Number.parseInt(process.argv[idx + 1], 10);
  if (Number.isNaN(n) || n < 0) {
    console.error(`Некорректный --${name}: ожидалось число, получено ${ce.yellow(`"${process.argv[idx + 1]}"`)}`);
    process.exit(1);
  }
  return n;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Строковый аргумент --keywords "A,B,C" → список; "none"/пусто → [] (без фильтра). */
function keywordsArg(def: string[]): string[] {
  const idx = process.argv.indexOf("--keywords");
  if (idx === -1 || idx === process.argv.length - 1) return def;
  const v = process.argv[idx + 1];
  if (v.trim().toLowerCase() === "none") return [];
  const list = v.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (list.length === 0) {
    console.error(`Некорректный --keywords: ожидался список через запятую или "none", получено ${ce.yellow(`"${v}"`)}`);
    process.exit(1);
  }
  return list;
}

const pages = arg("pages", config.defaultPages);
const vacancies = arg("vacancies", config.defaultVacancies);
const listTtlDays = arg("list-ttl-days", config.listTtlDays);
const detailTtlDays = arg("detail-ttl-days", config.detailTtlDays);
const dryRun = flag("dry-run");
const primaryKeywords = keywordsArg(config.filter.primaryKeywords);

console.log(
  `${c.dim("[config]")} pages=${c.bold(String(pages))} vacancies=${c.bold(String(vacancies))} ` +
    `listTtl=${listTtlDays}d detailTtl=${detailTtlDays}d ` +
    `delay=${config.delayMinMs}–${config.delayMaxMs}ms dryRun=${dryRun ? c.yellow("true") : "false"}`,
);
console.log(
  primaryKeywords.length > 0
    ? `${c.dim("[config]")} filter=${c.bold(`${primaryKeywords.length} категорий`)} ${c.dim(`(${primaryKeywords.join(", ")})`)}`
    : `${c.dim("[config]")} filter=${c.yellow("выкл (все вакансии)")}`,
);

runScrape({ pages, vacancies, listTtlDays, detailTtlDays, dryRun, primaryKeywords }).catch((err) => {
  console.error(ce.red("[scrape] фатальная ошибка:"), err instanceof Error ? err.stack : err);
  process.exit(1);
});
