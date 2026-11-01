// Офлайн-проверка парсеров на сырых семплах cache/research/ (без БД и сети).
// Запуск: pnpm check:fixtures
import fs from "node:fs";
import path from "node:path";
import { parseListPage } from "./parse-list.js";
import { parseDetailPage } from "./parse-detail.js";
import { buildSkillLookup, normalizeSkillKey, skillDictionaryWithCuratedAliases } from "../skills/dictionary.js";
import { parseApplicantStats } from "../competition/parse-applicant-stats.js";
import { computeApplicantPool, englishRank, experienceBucket, salaryRange } from "../competition/metrics.js";
import { c, ce } from "../log.js";

const RESEARCH_DIR = "cache/research";
const lookup = buildSkillLookup();
const DICTIONARY = skillDictionaryWithCuratedAliases();

interface FixtureExpectation {
  file: string;
  minSkills: number; // минимум распознанных djinni-навыков
  expectEnglish?: string; // ожидаемый уровень английского
  expectExperienceYears?: number; // ожидаемый стаж (лет)
  expectSalaryMin?: number;
  // Сигналы конкуренции из #job-publication-info
  expectViewsCount?: number | null; // просмотры «за весь час» (или одиночная строка)
  expectRepliesCount?: number | null;
  expectViews30d?: number | null; // разбивка «За 30 днів» — null у молодых вакансий
  expectReplies30d?: number | null;
  expectActivity?: string; // RecruiterActivity
  expectResponseAt?: string | null; // ISO-момент ответа рекрутера (tooltip, Europe/Kyiv)
}

const DETAIL_EXPECTATIONS: FixtureExpectation[] = [
  { file: "job-854811-software-architect.html", minSkills: 6, expectEnglish: "C1" }, // Python + 5 доп. + GCP
  {
    file: "job-849509-middle-senior-java-developer-bpmn.html",
    minSkills: 5,
    expectActivity: "HIGH",
    expectResponseAt: "2026-10-23T10:58:00.000Z",
  }, // Java, Spring, PG, Hibernate, RabbitMQ
  { file: "job-849428-technical-project-manager.html", minSkills: 0, expectActivity: "VERY_HIGH" }, // PM: skills-блок может отсутствовать
  { file: "job-849584-lead-backend-engineer.html", minSkills: 0 }, // только блок языков
  { file: "job-854858-senior-devops-engineer-spain.html", minSkills: 0 }, // только блок языков
  { file: "job-854897-junior-devops-engineer.html", minSkills: 0 },
  {
    file: "job-842889-mobile-qa-engineer.html",
    minSkills: 1, // Ручне тестування + REST API
    expectSalaryMin: 800,
    expectViewsCount: 864,
    expectRepliesCount: 210,
    expectViews30d: 420,
    expectReplies30d: 72,
    expectActivity: "LOW",
    expectResponseAt: "2026-08-25T16:53:00.000Z",
  },
  {
    file: "job-853489-quality-engineer.html",
    minSkills: 0,
    expectViewsCount: 560,
    expectRepliesCount: 257,
    expectViews30d: null, // djinni не показывает 30-дневную разбивку
    expectReplies30d: null,
    expectActivity: "LOW",
    expectResponseAt: "2026-10-23T17:22:00.000Z",
  },
  {
    file: "job-834543-senior-full-stack-java-python-react.html",
    minSkills: 2, // в блоке djinni только Python, React.js; остальные (Java, Spring…) — keyword-слой
    expectViewsCount: 305,
    expectRepliesCount: 34,
    expectViews30d: 147,
    expectReplies30d: 8,
    expectActivity: "HIGH",
    expectResponseAt: "2026-10-14T13:29:00.000Z", // 16:29 Kyiv (UTC+3) из tooltip
  },
];

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ${c.green("✓")} ${label}`);
  } else {
    failures++;
    console.error(`  ${ce.red("✗")} ${label} ${detail}`);
  }
}

// ---------- List-страницы ----------
console.log("\n== Страницы списка ==");
const listFiles = fs
  .readdirSync(RESEARCH_DIR)
  .filter((f) => f.startsWith("jobs-list-") && f.endsWith(".html"));

for (const file of listFiles) {
  const html = fs.readFileSync(path.join(RESEARCH_DIR, file), "utf8");
  const { items, jsonLdCount } = parseListPage(html, `file://${file}`);
  console.log(`\n${file}: ${items.length} вакансий, JSON-LD ${jsonLdCount}`);
  check("есть вакансии", items.length > 0);
  check("JSON-LD непуст", jsonLdCount > 0);

  const withDesc = items.filter((i) => i.description && i.description.length > 100);
  check("описания у большинства", withDesc.length >= items.length * 0.8, `(${withDesc.length}/${items.length})`);
  const withDate = items.filter((i) => i.datePosted !== null);
  check("datePosted у большинства", withDate.length >= items.length * 0.8, `(${withDate.length}/${items.length})`);

  // Детальный вывод первой вакансии для аудита
  const first = items[0];
  if (first) {
    console.log(
      `  пример: #${first.id} "${first.title}" — ${first.company ?? "?"}, ` +
        `тир ${first.salaryTier ?? "-"}, ${first.workFormat}, ${first.englishLevel}, ` +
        `опыт ${first.experienceYears ?? "?"} лет, дата ${first.datePosted?.toISOString().slice(0, 10) ?? "?"}`,
    );
  }
}

// ---------- Detail-страницы ----------
console.log("\n== Detail-страницы ==");
for (const exp of DETAIL_EXPECTATIONS) {
  const filePath = path.join(RESEARCH_DIR, exp.file);
  if (!fs.existsSync(filePath)) {
    check(`${exp.file} существует`, false);
    continue;
  }
  const html = fs.readFileSync(filePath, "utf8");
  const detail = parseDetailPage(html, `file://${exp.file}`);
  console.log(`\n${exp.file}`);
  if (!detail) {
    check("разобран", false);
    continue;
  }
  check("разобран", true, `#${detail.id} "${detail.title}"`);
  check(`навыков >= ${exp.minSkills}`, detail.skills.length >= exp.minSkills, `(получено ${detail.skills.length}: ${detail.skills.map((s) => s.name).join(", ")})`);
  if (exp.expectEnglish) {
    check(`английский = ${exp.expectEnglish}`, detail.englishLevel === exp.expectEnglish, `(получено ${detail.englishLevel})`);
  }
  if (exp.expectSalaryMin !== undefined) {
    check(`salaryMin = ${exp.expectSalaryMin}`, detail.salaryMin === exp.expectSalaryMin, `(получено ${detail.salaryMin})`);
  }
  if (exp.expectViewsCount !== undefined) {
    check(
      `просмотры всего = ${exp.expectViewsCount}`,
      detail.viewsCount === exp.expectViewsCount,
      `(получено ${detail.viewsCount})`,
    );
  }
  if (exp.expectRepliesCount !== undefined) {
    check(
      `отклики всего = ${exp.expectRepliesCount}`,
      detail.repliesCount === exp.expectRepliesCount,
      `(получено ${detail.repliesCount})`,
    );
  }
  if (exp.expectViews30d !== undefined) {
    check(
      `просмотры за 30 дн. = ${exp.expectViews30d}`,
      detail.views30d === exp.expectViews30d,
      `(получено ${detail.views30d})`,
    );
  }
  if (exp.expectReplies30d !== undefined) {
    check(
      `отклики за 30 дн. = ${exp.expectReplies30d}`,
      detail.replies30d === exp.expectReplies30d,
      `(получено ${detail.replies30d})`,
    );
  }
  if (exp.expectActivity !== undefined) {
    check(
      `активность рекрутера = ${exp.expectActivity}`,
      detail.recruiterActivity === exp.expectActivity,
      `(получено ${detail.recruiterActivity})`,
    );
  }
  if (exp.expectResponseAt !== undefined) {
    const got = detail.recruiterLastResponseAt?.toISOString() ?? null;
    check(
      `ответ рекрутера = ${exp.expectResponseAt}`,
      got === exp.expectResponseAt,
      `(получено ${got})`,
    );
  }

  // Keyword-слой: сколько словарных навыков находим в описании
  if (detail.description) {
    const desc = detail.description.toLowerCase();
    const dictHits: string[] = [];
    for (const entry of DICTIONARY) {
      const terms = [entry.name, ...entry.aliases];
      if (terms.some((t) => t.length >= 3 && desc.includes(t.toLowerCase()))) dictHits.push(entry.name);
    }
    console.log(`  ${c.dim("keyword-слой:")} ${dictHits.length} — ${dictHits.slice(0, 10).join(", ")}${dictHits.length > 10 ? "…" : ""}`);
  }
}

// ---------- Статистика кандидатов (apply_stats) ----------
console.log("\n== Статистика кандидатов ==");
const statsFixtures: { file: string; total: number; topSkill: string }[] = [
  { file: "applicant-stats-834543.json", total: 35, topSkill: "Java" },
  { file: "applicant-stats-691051.json", total: 96, topSkill: "CRM" },
  { file: "applicant-stats-720779.json", total: 17, topSkill: "C/C++" },
];
for (const f of statsFixtures) {
  const statsPath = path.join(RESEARCH_DIR, f.file);
  if (!fs.existsSync(statsPath)) {
    check(`${f.file} существует`, false);
    continue;
  }
  const raw = fs.readFileSync(statsPath, "utf8");
  const stats = parseApplicantStats(raw);
  if (!stats) {
    check(`${f.file} разобран`, false);
    continue;
  }
  check(`${f.file}: total_applicants = ${f.total}`, stats.totalApplicants === f.total, `(получено ${stats.totalApplicants})`);
  const top = [...stats.topSkills].sort((a, b) => b.count - a.count)[0];
  check(`${f.file}: топ-навык = ${f.topSkill}`, top?.name === f.topSkill, `(получено ${top?.name})`);

  const pool = computeApplicantPool(stats);
  check(`${f.file}: профиль кандидатов посчитан`, pool !== null);
  if (pool) {
    check(
      `${f.file}: сумма бакетов опыта > 0 и ≤ total`,
      pool.reportedExperience > 0 && pool.reportedExperience <= stats.totalApplicants,
      `(${pool.reportedExperience}/${stats.totalApplicants})`,
    );
    if (pool.experience5PlusShare !== null) {
      check(
        `${f.file}: доля 5+ лет в [0,1]`,
        pool.experience5PlusShare >= 0 && pool.experience5PlusShare <= 1,
        `(${pool.experience5PlusShare.toFixed(2)})`,
      );
    }
  }
}

// Нормализаторы меток djinni
check("experienceBucket('5-10 років')", experienceBucket("5-10 років")?.minYears === 5);
check("experienceBucket('10+ років')", experienceBucket("10+ років")?.maxYears === null);
check("experienceBucket('< 1 року')", experienceBucket("< 1 року")?.maxYears === 1);
check("englishRank('Носій мови') = 7", englishRank("Носій мови") === 7);
check("englishRank('B2') = 4", englishRank("B2") === 4);
check("salaryRange('$2700-3800')", salaryRange("$2700-3800")?.max === 3800);
check("salaryRange('<$2700')", salaryRange("<$2700")?.max === 2700);
check("parseApplicantStats(битый JSON) → null", parseApplicantStats("{oops") === null);

// ---------- Словарь: дубли ----------
console.log("\n== Словарь ==");
const names = new Set<string>();
const dupes: string[] = [];
for (const entry of DICTIONARY) {
  const key = entry.name.toLowerCase();
  if (names.has(key)) dupes.push(entry.name);
  names.add(key);
}
check("нет дублей canonical-имён", dupes.length === 0, `(дубли: ${dupes.join(", ")})`);

// Словарные сопоставления на семплах
const match = (raw: string): string | undefined => lookup.get(normalizeSkillKey(raw))?.name;
check("matchSkill('PostgreSQL')", match("PostgreSQL") === "PostgreSQL");
check("matchSkill('postgres')", match("postgres") === "PostgreSQL");
check("matchSkill('Spring Framework') → Spring", match("Spring Framework") === "Spring");
check("matchSkill('React.js') → React", match("React.js") === "React");

console.log(
  `\n== Итог: ${failures === 0 ? c.green("все проверки пройдены") : c.red(`${failures} проверок провалено`)} ==`,
);
process.exit(failures === 0 ? 0 : 1);
