// Детерминированная аналитика skill gap (specs/06): ядро MVP без ML.
// pnpm stats -- --skills React --window 30
// pnpm stats -- --skills React,TypeScript --window 90 --top 15
//
// Считает по окну (7/30/90 дней, фильтр по datePosted в БД):
// - share(X|S) = P(X|S): доля вакансий с навыками S, где ещё встречается X;
// - lift = P(X|S) / P(X): «неожиданность» связи (выше = комбинация специфична);
// - вес: must=1.0, nice=0.5 (nice-to-have вкладывается в половину).
// Выдаёт пробелы (X ∉ S, отсортированы по share) — ответ на «чего мне не хватает».
import { prisma } from "../db.js";
import { matchSkill } from "../skills/extract.js";
import { c, ce } from "../log.js";

function arg(name: string, def: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

const skillsArg = arg("skills");
if (!skillsArg) {
  console.error(ce.red("Укажите навыки:"), "pnpm stats -- --skills React,TypeScript [--window 30] [--top 15]");
  process.exit(1);
}

const windowDays = Number.parseInt(arg("window", "30") ?? "30", 10);
const topN = Number.parseInt(arg("top", "15") ?? "15", 10);

// Разрешить имена пользовательских навыков через словарь
const seedSkills = skillsArg.split(",").map((s) => {
  const resolved = matchSkill(s.trim());
  if (!resolved) {
    console.warn(`[stats] навык ${ce.yellow(`"${s.trim()}"`)} не найден в словаре — используем как есть`);
    return s.trim();
  }
  return resolved.name;
});
console.log(`[stats] окно ${windowDays} дн., seed-навыки: ${c.green(seedSkills.join(", "))}`);

const since = new Date(Date.now() - windowDays * 86_400_000);

const jobs = await prisma.jobPosting.findMany({
  where: { status: "ACTIVE", datePosted: { gte: since } },
  include: { skills: { include: { skill: true } } },
});

if (jobs.length === 0) {
  console.log(`[stats] вакансий за ${windowDays} дн. нет — запусти скрейп сначала`);
  process.exit(0);
}

// Индекс: навык → список вакансий с весом
interface JobWeight {
  jobId: number;
  weight: number; // 1.0 must / 0.5 nice
  years: number | null;
}

const bySkill = new Map<string, JobWeight[]>();
for (const job of jobs) {
  for (const req of job.skills) {
    const key = req.skill.name;
    const weight = req.isRequired ? 1.0 : 0.5;
    const list = bySkill.get(key) ?? [];
    // Дедуп по вакансии: берём максимум веса
    const existing = list.find((w) => w.jobId === job.id);
    if (existing) existing.weight = Math.max(existing.weight, weight);
    else list.push({ jobId: job.id, weight, years: req.yearsRequired });
    bySkill.set(key, list);
  }
}

const totalJobs = jobs.length;

// Seed-множество: вакансии, содержащие ВСЕ навыки S (с порогом веса 0.3 — must или хотя бы nice)
const seedSets = seedSkills.map((s) => bySkill.get(s) ?? []);
if (seedSets.some((set) => set.length === 0)) {
  const empty = seedSkills.filter((_, i) => seedSets[i].length === 0);
  console.warn(`[stats] за окном нет вакансий с: ${ce.yellow(empty.join(", "))} — результат будет пуст`);
}

const seedJobIds = new Set(seedSets[0]?.map((w) => w.jobId) ?? []);
for (const set of seedSets.slice(1)) {
  const ids = new Set(set.map((w) => w.jobId));
  for (const id of [...seedJobIds]) if (!ids.has(id)) seedJobIds.delete(id);
}

// Взвешенная сумма по seed-вакансиям (для средних показателей)
const seedJobIdList = [...seedJobIds];
const seedCount = seedJobIdList.length;

if (seedCount === 0) {
  console.log("[stats] пересечение seed-навыков пусто — расширь окно или смени навыки");
  process.exit(0);
}

// Share(X|S) и lift
const seedSet = new Set(seedJobIdList);
const gapCandidates: {
  name: string;
  share: number;
  lift: number;
  bothJobs: number;
  avgYears: number | null;
  mustShare: number;
}[] = [];

for (const [skillName, weights] of bySkill) {
  if (seedSkills.includes(skillName)) continue;

  let bothWeighted = 0;
  let mustCount = 0;
  const yearsList: number[] = [];
  for (const w of weights) {
    if (!seedSet.has(w.jobId)) continue;
    bothWeighted += w.weight;
    if (w.weight >= 1.0) mustCount++;
    if (w.years !== null) yearsList.push(w.years);
  }
  if (bothWeighted === 0) continue;

  const globalWeighted = weights.reduce((acc, w) => acc + w.weight, 0);

  // share — взвешенная доля seed-вакансий с навыком X
  const share = bothWeighted / seedCount;
  // lift — отношение к глобальной (независимость = 1.0)
  const globalP = globalWeighted / totalJobs;
  const lift = globalP > 0 ? share / globalP : 0;

  gapCandidates.push({
    name: skillName,
    share,
    lift,
    bothJobs: weights.filter((w) => seedSet.has(w.jobId)).length,
    avgYears: yearsList.length > 0 ? yearsList.reduce((a, b) => a + b, 0) / yearsList.length : null,
    mustShare: bothWeighted > 0 ? mustCount / weights.filter((w) => seedSet.has(w.jobId)).length : 0,
  });
}

gapCandidates.sort((a, b) => b.share - a.share);

// ---------- Вывод ----------
console.log(`\n${c.bold(`=== ${seedSkills.join(" + ")} — окно ${windowDays} дн. ===`)}`);
console.log(`Вакансий в окне: ${totalJobs}; с вашим стеком: ${c.bold(String(seedCount))} (${c.bold(((seedCount / totalJobs) * 100).toFixed(1))}% рынка)`);

console.log(`\n${c.bold(`--- Топ-${topN} навыков рядом с вашим стеком (share = P(X|S)) ---`)}`);
console.log("Скилл                  share  lift  вакансий  must%  ср.опыт");
for (const g of gapCandidates.slice(0, topN)) {
  const shareStr = `${(g.share * 100).toFixed(0)}%`.padStart(4);
  const liftStr = g.lift.toFixed(2).padStart(5);
  const jobsStr = String(g.bothJobs).padStart(5);
  const mustStr = `${(g.mustShare * 100).toFixed(0)}%`.padStart(5);
  const yearsStr = g.avgYears !== null ? `${g.avgYears.toFixed(1)} г.` : "  —  ";
  const marker = g.lift >= 1.5 ? c.cyan(" ◀ специфична") : "";
  console.log(`${g.name.padEnd(24)} ${shareStr} ${liftStr} ${jobsStr}  ${mustStr}  ${yearsStr}${marker}`);
}

// Пробелы: навыки с высоким share, которых нет в seed (это и есть «чего не хватает»)
console.log(`\n${c.bold("--- Пробелы (высокий share, lift > 1.2 = востребованы именно в этой связке) ---")}`);
const gaps = gapCandidates.filter((g) => g.lift > 1.2).slice(0, 10);
if (gaps.length === 0) {
  console.log("Явных пробелов не найдено (данных мало или стек покрывает рынок)");
} else {
  for (const g of gaps) {
    console.log(
      `  ${c.yellow(g.name)}: ${(g.share * 100).toFixed(0)}% вакансий со стеком, ` +
        `lift ${c.bold(g.lift.toFixed(2))}, ` +
        `ср. требуемый опыт ${g.avgYears !== null ? `${g.avgYears.toFixed(1)} г.` : "—"}`,
    );
  }
}

// Базовые частоты навыков в окне (глобальный контекст P(X))
console.log(`\n${c.bold("--- Топ-10 навыков рынка в окне (глобальный P(X)) ---")}`);
const globalTop = [...bySkill.entries()]
  .map(([name, weights]) => ({
    name,
    share: weights.reduce((acc, w) => acc + w.weight, 0) / totalJobs,
  }))
  .sort((a, b) => b.share - a.share)
  .slice(0, 10);
for (const g of globalTop) {
  console.log(`  ${g.name.padEnd(24)} ${(g.share * 100).toFixed(0)}%`);
}

await prisma.$disconnect();
