// Курация словаря: pnpm skills:promote
//
// Три режима (ровно один), по умолчанию dry-run — печатает план без изменений:
//   новый навык:  pnpm skills:promote -- --name "Three.js" --category FRONTEND [--aliases "ThreeJS"] [--as "Three.js"]
//   слияние:      pnpm skills:promote -- --name "Nest.js" --merge-into "NestJS"
//   удаление шума: pnpm skills:promote -- --name "2 роки" --drop
//
// Словарь (src/skills/dictionary.ts) — единственный источник истины: промоушен пишет
// запись в curated-блок, затем pnpm seed:skills переносит её в БД, а pnpm parse
// переразбирает кэш с новым словарём. Без --apply ничего не меняется.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Prisma, SkillSource } from "@prisma/client";
import { SkillCategory } from "@prisma/client";
import { prisma } from "../db.js";
import {
  CURATED_ALIASES_MARKER,
  SKILL_DICTIONARY,
  CURATED_ADDITIONS_MARKER,
  buildSkillLookup,
  normalizeSkillKey,
  skillDictionaryWithCuratedAliases,
} from "./dictionary.js";
import { buildLooseLookup, suggestionKey } from "./unresolved.js";
import { c, ce } from "../log.js";

function arg(name: string, def: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const nameArg = arg("name");
const asArg = arg("as");
const categoryArg = arg("category");
const aliasesArg = arg("aliases");
const mergeIntoArg = arg("merge-into");
const drop = flag("drop");
const apply = flag("apply");

if (!nameArg) {
  console.error(
    ce.red("Укажите навык:"),
    'pnpm skills:promote -- --name "<нераспознанное>" (--category CAT [--aliases a,b] | --merge-into "<canonical>" | --drop) [--apply]',
  );
  process.exit(1);
}
const skillName: string = nameArg; // сужение: nameArg гарантированно строка дальше
const modeCount = [mergeIntoArg !== null, drop, categoryArg !== null].filter(Boolean).length;
if (modeCount !== 1) {
  console.error(ce.red("Нужен ровно один режим:"), "--category (новый) | --merge-into (слияние) | --drop (удаление шума)");
  process.exit(1);
}
if (categoryArg !== null && !(categoryArg in SkillCategory)) {
  console.error(ce.red(`Неизвестная категория: ${categoryArg}`), `— одна из: ${Object.keys(SkillCategory).join(", ")}`);
  process.exit(1);
}

const DICT_PATH = fileURLToPath(new URL("./dictionary.ts", import.meta.url));
const canonicalName = (asArg ?? skillName).trim();
const extraAliases = (aliasesArg ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter((a) => a.length > 0);

// Приоритет источников при переносе связей (как в extract.ts)
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  DJINNI_STRUCTURED: 3,
  DJINNI_EXTRA: 2,
  DESCRIPTION_KEYWORD: 1,
  LLM_DESCRIPTION: 0,
};

async function main(): Promise<void> {
  const lookup = buildSkillLookup();
  const loose = buildLooseLookup();
  const merged = skillDictionaryWithCuratedAliases();
  const dictEntry =
    merged.find((e) => e.name.toLowerCase() === canonicalName.toLowerCase()) ??
    lookup.get(suggestionKey(canonicalName)) ??
    null;

  // Источник в БД: Skill под сырое имя (нераспознанный кандидат)
  const sourceSkill =
    (await prisma.skill.findUnique({ where: { name: skillName } })) ??
    (await prisma.skill.findFirst({ where: { name: { equals: skillName, mode: "insensitive" } } }));

  if (drop) {
    await runDrop(sourceSkill);
    return;
  }

  if (mergeIntoArg !== null) {
    await runMerge(mergeIntoArg.trim(), sourceSkill, lookup, loose, dictEntry);
    return;
  }

  // Режим: новый навык
  const category = categoryArg as SkillCategory;
  const existing = lookup.get(suggestionKey(canonicalName)) ?? loose.get(suggestionKey(canonicalName)) ?? null;
  if (existing && existing.name.toLowerCase() !== canonicalName.toLowerCase()) {
    console.error(
      ce.red(`«${canonicalName}» уже резолвится в словаре как «${existing.name}» — используй --merge-into "${existing.name}"`),
    );
    process.exit(1);
  }
  if (existing) {
    console.error(ce.red(`«${canonicalName}» уже есть в словаре как canonical — дубль не добавляем`));
    process.exit(1);
  }

  const aliases = [...new Set([...(skillName !== canonicalName ? [skillName] : []), ...extraAliases])];
  const entryLine = `  { name: ${JSON.stringify(canonicalName)}, category: ${JSON.stringify(category)}, aliases: [${aliases.map((a) => JSON.stringify(a)).join(", ")}] },`;

  console.log(`${c.bold("[promote] режим")} ${c.cyan("новый навык")}; ${apply ? c.green("--apply") : c.yellow("dry-run")}`);
  console.log(`  ${c.dim("словарь:")} + ${entryLine.trim()}`);

  if (sourceSkill) {
    const conflict =
      sourceSkill.name !== canonicalName
        ? await prisma.skill.findUnique({ where: { name: canonicalName } })
        : null;
    if (conflict) {
      // Имя каноникала уже занято другим Skill — это слияние, а не переименование
      console.log(`  ${c.dim("БД:")} перенос ${sourceSkill.id} → ${conflict.id} («${canonicalName}» уже есть)`);
    } else {
      const action = sourceSkill.name === canonicalName ? "обновить" : `rename «${canonicalName}»`;
      console.log(
        `  ${c.dim("БД:")} skill ${sourceSkill.id} «${sourceSkill.name}» → ${action}, ` +
          `isCanonical=true, category=${category}, aliases=[${aliases.join(", ")}]`,
      );
    }
  } else {
    console.log(`  ${c.dim("БД:")} Skill «${canonicalName}» будет создан при seed:skills`);
  }

  if (!apply) {
    console.log(`\n${c.yellow("Dry-run:")} ничего не изменено. Повтори с ${c.bold("--apply")} для записи.`);
    await prisma.$disconnect();
    return;
  }

  await insertDictLine(CURATED_ADDITIONS_MARKER, entryLine);
  console.log(`  ${c.green("✓")} словарь дополнен: ${c.cyan(DICT_PATH)}`);

  if (sourceSkill) {
    const conflict =
      sourceSkill.name !== canonicalName ? await prisma.skill.findUnique({ where: { name: canonicalName } }) : null;
    if (conflict) {
      await moveRequirements(sourceSkill.id, conflict.id);
    } else {
      await prisma.skill.update({
        where: { id: sourceSkill.id },
        data: { name: canonicalName, category, aliases, isCanonical: true },
      });
    }
    console.log(`  ${c.green("✓")} БД обновлена`);
  }

  printNextSteps();
  await prisma.$disconnect();
}

async function runMerge(
  targetName: string,
  sourceSkill: { id: number; name: string } | null,
  lookup: ReturnType<typeof buildSkillLookup>,
  loose: ReturnType<typeof buildLooseLookup>,
  dictEntry: (typeof SKILL_DICTIONARY)[number] | null,
): Promise<void> {
  const target = lookup.get(suggestionKey(targetName)) ?? loose.get(suggestionKey(targetName)) ?? null;
  if (!target) {
    console.error(
      ce.red(`«${targetName}» не найден в словаре как canonical — сначала добавь его (--category) или проверь имя`),
    );
    process.exit(1);
  }
  if (target.name.toLowerCase() === skillName.trim().toLowerCase()) {
    console.error(ce.red("Имя совпадает с целевым — слияние бессмысленно"));
    process.exit(1);
  }

  const alreadyAlias =
    target.aliases.some((a) => a.toLowerCase() === skillName.trim().toLowerCase()) ||
    // Строгий lookup — именно он используется экстракцией (extract.matchSkill):
    // loose совпадение ещё не значит, что парсер разрешит имя при следующем parse
    lookup.get(normalizeSkillKey(skillName))?.name === target.name;

  console.log(`${c.bold("[promote] режим")} ${c.cyan(`слияние → ${target.name}`)}; ${apply ? c.green("--apply") : c.yellow("dry-run")}`);
  if (alreadyAlias) {
    console.log(`  ${c.dim("словарь:")} «${skillName}» уже алиас «${target.name}» — пропускаем`);
  } else {
    const aliasLine = `  { name: ${JSON.stringify(target.name)}, aliases: [${JSON.stringify(skillName)}] },`;
    console.log(`  ${c.dim("словарь:")} + алиас в CURATED_ALIASES — ${aliasLine.trim()}`);
  }

  const targetSkill = await findOrCreateCanonicalSkill(target.name, target.category);
  if (sourceSkill && sourceSkill.id === targetSkill.id) {
    console.log(`  ${c.dim("БД:")} это один и тот же Skill — связей переносить не нужно`);
  } else if (sourceSkill) {
    const count = await countRequirements(sourceSkill.id);
    console.log(`  ${c.dim("БД:")} перенос ${count} связей ${sourceSkill.id} «${sourceSkill.name}» → ${targetSkill.id} «${target.name}», затем удаление источника`);
  } else {
    console.log(`  ${c.dim("БД:")} Skill «${skillName}» в БД нет — только словарь (перепарсинг перенесёт сам)`);
  }

  if (!apply) {
    console.log(`\n${c.yellow("Dry-run:")} ничего не изменено. Повтори с ${c.bold("--apply")} для записи.`);
    await prisma.$disconnect();
    return;
  }

  if (!alreadyAlias) {
    await insertDictLine(CURATED_ALIASES_MARKER, `  { name: ${JSON.stringify(target.name)}, aliases: [${JSON.stringify(skillName)}] },`);
    console.log(`  ${c.green("✓")} алиас добавлен: ${c.cyan(DICT_PATH)}`);
  }
  if (sourceSkill && sourceSkill.id !== targetSkill.id) {
    const { moved, merged } = await moveRequirements(sourceSkill.id, targetSkill.id);
    console.log(`  ${c.green("✓")} перенос: ${moved}, слияние конфликтов: ${merged}; источник удалён`);
  } else if (dictEntry) {
    console.log(`  ${c.dim("(словарная запись уже актуальна)")}`);
  }

  printNextSteps();
  await prisma.$disconnect();
}

async function runDrop(sourceSkill: { id: number; name: string } | null): Promise<void> {
  console.log(`${c.bold("[promote] режим")} ${c.cyan("удаление шума")}; ${apply ? c.green("--apply") : c.yellow("dry-run")}`);
  if (!sourceSkill) {
    console.log(`  ${c.dim("БД:")} Skill «${skillName}» не найден — нечего удалять`);
    await prisma.$disconnect();
    return;
  }
  if (sourceSkill) {
    const count = await countRequirements(sourceSkill.id);
    console.log(`  ${c.dim("БД:")} удалить Skill ${sourceSkill.id} «${sourceSkill.name}» и ${count} связей`);
  }
  console.log(`  ${c.dim("словарь:")} не трогаем — имя не попадает в словарь. ` +
    `Если шум из бага парсера («2 роки» и т.п.) — он уже починен, после pnpm parse не вернётся; ` +
    `иначе djinni снова создаст его при следующем парсинге.`);

  if (!apply) {
    console.log(`\n${c.yellow("Dry-run:")} ничего не изменено. Повтори с ${c.bold("--apply")} для записи.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction([
    prisma.jobSkillRequirement.deleteMany({ where: { skillId: sourceSkill.id } }),
    prisma.skill.delete({ where: { id: sourceSkill.id } }),
  ]);
  console.log(`  ${c.green("✓")} удалено`);
  await prisma.$disconnect();
}

async function countRequirements(skillId: number): Promise<number> {
  return prisma.jobSkillRequirement.count({ where: { skillId } });
}

/** Перенос связей sourceSkillId → targetSkillId с дедупликацией по jobId. */
async function moveRequirements(sourceSkillId: number, targetSkillId: number): Promise<{ moved: number; merged: number }> {
  const reqs = await prisma.jobSkillRequirement.findMany({ where: { skillId: sourceSkillId } });
  const existing = await prisma.jobSkillRequirement.findMany({ where: { skillId: targetSkillId } });
  const byJob = new Map(existing.map((r) => [r.jobId, r]));

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  let moved = 0;
  let merged = 0;
  for (const req of reqs) {
    const target = byJob.get(req.jobId);
    if (!target) {
      updates.push(
        prisma.jobSkillRequirement.update({
          where: { id: req.id },
          data: { skillId: targetSkillId },
        }),
      );
      moved++;
      continue;
    }
    // Конфликт jobId+skillId: берём более приоритетный источник, годы — максимум
    const better = SOURCE_PRIORITY[req.source] > SOURCE_PRIORITY[target.source] ? req : target;
    updates.push(
      prisma.jobSkillRequirement.update({
        where: { id: target.id },
        data: {
          source: better.source,
          isRequired: req.isRequired || target.isRequired,
          yearsRequired: Math.max(req.yearsRequired ?? 0, target.yearsRequired ?? 0) || null,
          rawName: better.rawName,
        },
      }),
    );
    merged++;
  }
  updates.push(prisma.skill.delete({ where: { id: sourceSkillId } }));
  await prisma.$transaction(updates);
  return { moved, merged };
}

/** Найти канонический Skill по имени словаря, создать при отсутствии. */
async function findOrCreateCanonicalSkill(name: string, category: SkillCategory): Promise<{ id: number; name: string }> {
  const found =
    (await prisma.skill.findUnique({ where: { name } })) ??
    (await prisma.skill.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }));
  if (found) return found;
  return prisma.skill.create({ data: { name, category, isCanonical: true, aliases: [] } });
}

/** Вставка строки в curated-блок словаря после маркера (идемпотентно по строке). */
async function insertDictLine(marker: string, line: string): Promise<void> {
  const src = await fs.readFile(DICT_PATH, "utf8");
  if (src.includes(line)) return; // уже добавлено
  const markerIdx = src.indexOf(marker);
  if (markerIdx === -1) throw new Error(`Маркер не найден в dictionary.ts: ${marker}`);
  const lineEnd = src.indexOf("\n", markerIdx);
  const next = src.slice(0, lineEnd + 1) + line + "\n" + src.slice(lineEnd + 1);
  await fs.writeFile(DICT_PATH, next, "utf8");
}

function printNextSteps(): void {
  console.log(
    `\n${c.bold("[promote] следующие шаги:")} pnpm seed:skills ${c.dim("(синхронизировать словарь в БД)")} → ` +
      `pnpm parse ${c.dim("(переразобрать кэш с новым словарём)")}`,
  );
}

main().catch((err) => {
  console.error(ce.red("[promote] фатальная ошибка:"), err);
  process.exit(1);
});
