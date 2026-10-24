// Офлайн-проверка парсеров на сырых семплах cache/research/ (без БД и сети).
// Запуск: pnpm check:fixtures
import fs from "node:fs";
import path from "node:path";
import { parseListPage } from "./parse-list.js";
import { parseDetailPage } from "./parse-detail.js";
import { buildSkillLookup, SKILL_DICTIONARY } from "../skills/dictionary.js";
import { c, ce } from "../log.js";

const RESEARCH_DIR = "cache/research";
const lookup = buildSkillLookup();

interface FixtureExpectation {
  file: string;
  minSkills: number; // минимум распознанных djinni-навыков
  expectEnglish?: string; // ожидаемый уровень английского
  expectExperienceYears?: number; // ожидаемый стаж (лет)
  expectSalaryMin?: number;
}

const DETAIL_EXPECTATIONS: FixtureExpectation[] = [
  { file: "job-854811-software-architect.html", minSkills: 6, expectEnglish: "C1" }, // Python + 5 доп. + GCP
  { file: "job-849509-middle-senior-java-developer-bpmn.html", minSkills: 5 }, // Java, Spring, PG, Hibernate, RabbitMQ
  { file: "job-849428-technical-project-manager.html", minSkills: 0 }, // PM: skills-блок может отсутствовать
  { file: "job-849584-lead-backend-engineer.html", minSkills: 0 }, // только блок языков
  { file: "job-854858-senior-devops-engineer-spain.html", minSkills: 0 }, // только блок языков
  { file: "job-854897-junior-devops-engineer.html", minSkills: 0 },
  { file: "job-842889-mobile-qa-engineer.html", minSkills: 1, expectSalaryMin: 800 }, // Ручне тестування + REST API
  { file: "job-853489-quality-engineer.html", minSkills: 0 }, // только блок языков
  { file: "job-834543-senior-full-stack-java-python-react.html", minSkills: 2 }, // в блоке djinni только Python, React.js; остальные (Java, Spring…) — keyword-слой
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

  // Keyword-слой: сколько словарных навыков находим в описании
  if (detail.description) {
    const desc = detail.description.toLowerCase();
    const dictHits: string[] = [];
    for (const entry of SKILL_DICTIONARY) {
      const terms = [entry.name, ...entry.aliases];
      if (terms.some((t) => t.length >= 3 && desc.includes(t.toLowerCase()))) dictHits.push(entry.name);
    }
    console.log(`  ${c.dim("keyword-слой:")} ${dictHits.length} — ${dictHits.slice(0, 10).join(", ")}${dictHits.length > 10 ? "…" : ""}`);
  }
}

// ---------- Словарь: дубли ----------
console.log("\n== Словарь ==");
const names = new Set<string>();
const dupes: string[] = [];
for (const entry of SKILL_DICTIONARY) {
  const key = entry.name.toLowerCase();
  if (names.has(key)) dupes.push(entry.name);
  names.add(key);
}
check("нет дублей canonical-имён", dupes.length === 0, `(дубли: ${dupes.join(", ")})`);

// Словарные сопоставления на семплах
const match = (raw: string): string | undefined => lookup.get(raw.toLowerCase())?.name;
check("matchSkill('PostgreSQL')", match("PostgreSQL") === "PostgreSQL");
check("matchSkill('postgres')", match("postgres") === "PostgreSQL");
check("matchSkill('Spring Framework') → Spring", match("Spring Framework") === "Spring");
check("matchSkill('React.js') → React", match("React.js") === "React");

console.log(
  `\n== Итог: ${failures === 0 ? c.green("все проверки пройдены") : c.red(`${failures} проверок провалено`)} ==`,
);
process.exit(failures === 0 ? 0 : 1);
