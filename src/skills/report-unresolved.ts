// Отчёт по нераспознанным навыкам всех вакансий: pnpm skills:unresolved
//
// pnpm skills:unresolved                      — всё время, active-вакансии, топ-50
// pnpm skills:unresolved -- --window 30 --min-jobs 2 --top 100
// pnpm skills:unresolved -- --export          — JSON + CSV в cache/analysis/
// pnpm skills:unresolved -- --status all --samples
//
// Группирует Skill(isCanonical=false) по suggestionKey (варианты написания сливаются),
// считает число вакансий/долю/источники и классифицирует каждую группу:
// alias → split → similar → noise → new. Вывод отсортирован по числу вакансий.
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillSource } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { c, ce, pad } from "../log.js";
import { classifyCandidate, suggestionKey, VERDICT_LABELS, SOURCE_LABELS, type Verdict } from "./unresolved.js";

function arg(name: string, def: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const windowDays = Number.parseInt(arg("window", "0") ?? "0", 10);
const minJobs = Number.parseInt(arg("min-jobs", "1") ?? "1", 10);
const topN = Number.parseInt(arg("top", "50") ?? "50", 10);
const statusArg = arg("status", "active") ?? "active";
const doExport = flag("export");
const showSamples = flag("samples");
if ([windowDays, minJobs, topN].some((n) => Number.isNaN(n) || n < 0) || !["active", "all"].includes(statusArg)) {
  console.error(ce.red("Некорректные аргументы:"), "--window N, --min-jobs N, --top N, --status active|all");
  process.exit(1);
}

interface VariantStat {
  name: string;
  jobIds: Set<number>;
  sources: Set<SkillSource>;
}

interface Group {
  key: string;
  variants: Map<string, VariantStat>;
  jobIds: Set<number>;
  sources: Set<SkillSource>;
  must: number;
  nice: number;
  samples: { id: number; title: string; url: string }[];
}

async function main(): Promise<void> {
  const since = windowDays > 0 ? new Date(Date.now() - windowDays * 86_400_000) : null;
  const jobWhere = {
    ...(statusArg === "active" ? { status: "ACTIVE" as const } : {}),
    ...(since ? { datePosted: { gte: since } } : {}),
  };

  const [totalJobs, skills] = await Promise.all([
    prisma.jobPosting.count({ where: jobWhere }),
    prisma.skill.findMany({
      where: { isCanonical: false },
      include: {
        requirements: {
          where: { job: jobWhere },
          include: { job: { select: { id: true, title: true, url: true } } },
        },
      },
    }),
  ]);

  if (totalJobs === 0) {
    console.log(`[unresolved] вакансий${windowDays > 0 ? ` за ${windowDays} дн.` : ""} нет — запусти скрейп сначала`);
    await prisma.$disconnect();
    return;
  }

  // Группировка вариантов написания по suggestionKey
  const groups = new Map<string, Group>();
  for (const skill of skills) {
    for (const req of skill.requirements) {
      const variantName = (req.rawName ?? skill.name).trim() || skill.name;
      const key = suggestionKey(skill.name);
      let group = groups.get(key);
      if (!group) {
        group = { key, variants: new Map(), jobIds: new Set(), sources: new Set(), must: 0, nice: 0, samples: [] };
        groups.set(key, group);
      }
      let variant = group.variants.get(variantName);
      if (!variant) {
        variant = { name: variantName, jobIds: new Set(), sources: new Set() };
        group.variants.set(variantName, variant);
      }
      variant.jobIds.add(req.jobId);
      variant.sources.add(req.source);
      group.jobIds.add(req.jobId);
      group.sources.add(req.source);
      if (req.isRequired) group.must++;
      else group.nice++;
      if (group.samples.length < 5 && !group.samples.some((s) => s.id === req.jobId)) {
        group.samples.push({ id: req.jobId, title: req.job.title, url: req.job.url });
      }
    }
  }

  // Классификация: лучший вердикт по всем вариантам группы (alias > split > similar > noise > new)
  const verdictRank: Record<Verdict, number> = { alias: 4, split: 3, similar: 2, noise: 1, new: 0 };
  interface Row {
    group: Group;
    dominant: string; // вариант с максимумом вакансий
    verdict: Verdict;
    suggestion: string;
  }
  const rows: Row[] = [];
  for (const group of groups.values()) {
    const variants = [...group.variants.values()].sort((a, b) => b.jobIds.size - a.jobIds.size);
    const dominant = variants[0]?.name ?? group.key;
    let best = classifyCandidate(dominant);
    for (const v of variants.slice(1)) {
      const cand = classifyCandidate(v.name);
      if (verdictRank[cand.verdict] > verdictRank[best.verdict]) best = cand;
    }
    rows.push({ group, dominant, verdict: best.verdict, suggestion: best.suggestion });
  }

  rows.sort((a, b) => b.group.jobIds.size - a.group.jobIds.size || a.dominant.localeCompare(b.dominant));
  const filtered = rows.filter((r) => r.group.jobIds.size >= minJobs);
  const shown = topN > 0 ? filtered.slice(0, topN) : filtered;

  const unresolvedJobIds = new Set<number>();
  for (const r of rows) for (const id of r.group.jobIds) unresolvedJobIds.add(id);
  const requirementCount = skills.reduce((acc, s) => acc + s.requirements.length, 0);

  const scope = `${windowDays > 0 ? `окно ${windowDays} дн., ` : ""}статус ${statusArg}`;
  console.log(
    `\n${c.bold("[unresolved]")} ${scope}: активных вакансий ${c.bold(String(totalJobs))}, ` +
      `нераспознанных навыков ${c.yellow(String(skills.length))} ` +
      `(${c.yellow(String(requirementCount))} связей, ${c.yellow(String(unresolvedJobIds.size))} вакансий), ` +
      `групп вариантов ${c.bold(String(rows.length))}` +
      (filtered.length !== rows.length ? ` · после --min-jobs ${minJobs}: ${filtered.length}` : ""),
  );

  if (shown.length === 0) {
    console.log(`[unresolved] кандидатов нет${minJobs > 1 ? ` при --min-jobs ${minJobs}` : ""} — словарь покрывает данные`);
    await prisma.$disconnect();
    return;
  }

  const nameWidth = Math.min(
    38,
    shown.reduce((acc, r) => Math.max(acc, r.dominant.length + (r.group.variants.size > 1 ? 4 : 0)), 28),
  );
  console.log(
    `\n ${pad("#", 4)}${pad("навык", nameWidth)} ${pad("вакансий", 9)} ${pad("доля", 6)} ` +
      `${pad("источники", 24)} ${pad("вердикт", 11)} действие`,
  );
  shown.forEach((row, i) => {
    const { group } = row;
    const share = ((group.jobIds.size / totalJobs) * 100).toFixed(1);
    const labelPlain = row.dominant + (group.variants.size > 1 ? ` +${group.variants.size - 1}` : "");
    const sources = [...group.sources].map((s) => SOURCE_LABELS[s] ?? s).sort().join(",");
    const verdictColor =
      row.verdict === "noise" ? c.yellow : row.verdict === "alias" || row.verdict === "split" ? c.green : c.dim;
    console.log(
      ` ${pad(String(i + 1), 4)}${pad(labelPlain, nameWidth)} ${pad(String(group.jobIds.size), 9)} ` +
        `${pad(`${share}%`, 6)} ${pad(sources, 24)} ${verdictColor(pad(VERDICT_LABELS[row.verdict], 11))} ` +
        `${c.cyan(row.suggestion)}`,
    );
    if (showSamples) {
      for (const s of group.samples.slice(0, 3)) {
        console.log(`       ${c.dim(`#${s.id} «${s.title}»`)}`);
      }
    }
  });

  console.log(
    `\n${c.dim("Курация:")} pnpm skills:promote -- --name "<нераспознанное>" --category <CAT> [--aliases a,b] [--apply]` +
      `\n${c.dim("Слияние:")} pnpm skills:promote -- --name "<вариант>" --merge-into "<canonical>" [--apply]` +
      `\n${c.dim("Шум:")}     pnpm skills:promote -- --name "<мусор>" --drop [--apply]`,
  );

  if (doExport) await exportRows(rows, totalJobs, windowDays, statusArg);

  await prisma.$disconnect();
}

async function exportRows(
  rows: { group: Group; dominant: string; verdict: Verdict; suggestion: string }[],
  totalJobs: number,
  windowDays: number,
  statusArg: string,
): Promise<void> {
  await fs.mkdir(config.analysisDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const suffix = windowDays > 0 ? `-w${windowDays}` : "";
  const base = path.join(config.analysisDir, `unresolved-${date}${suffix}`);

  const json = {
    meta: {
      generatedAt: new Date().toISOString(),
      windowDays: windowDays > 0 ? windowDays : null,
      status: statusArg,
      totalJobs,
      groupCount: rows.length,
    },
    groups: rows.map((r) => ({
      name: r.dominant,
      variants: [...r.group.variants.values()].map((v) => ({ name: v.name, jobs: v.jobIds.size })),
      verdict: r.verdict,
      suggestion: r.suggestion,
      jobCount: r.group.jobIds.size,
      share: Number((r.group.jobIds.size / totalJobs).toFixed(4)),
      sources: [...r.group.sources].sort(),
      must: r.group.must,
      nice: r.group.nice,
      sampleJobs: r.group.samples,
    })),
  };
  await fs.writeFile(`${base}.json`, JSON.stringify(json, null, 2), "utf8");

  const header = [
    "name", "variants", "verdict", "suggestion", "job_count", "share_pct",
    "sources", "must", "nice", "sample_job_ids",
  ];
  const csvRows = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.dominant,
        [...r.group.variants.keys()].join(" | "),
        r.verdict,
        r.suggestion,
        r.group.jobIds.size,
        ((r.group.jobIds.size / totalJobs) * 100).toFixed(1),
        [...r.group.sources].sort().join("|"),
        r.group.must,
        r.group.nice,
        r.group.samples.map((s) => s.id).join("|"),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  await fs.writeFile(`${base}.csv`, csvRows.join("\n"), "utf8");

  console.log(`\n${c.bold("[unresolved] экспорт:")} JSON ${c.cyan(`${base}.json`)} · CSV ${c.cyan(`${base}.csv`)}`);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

main().catch((err) => {
  console.error(ce.red("[unresolved] фатальная ошибка:"), err);
  process.exit(1);
});
