// Загрузка seed-словаря навыков в БД: pnpm seed:skills
import { prisma } from "../db.js";
import { SKILL_DICTIONARY } from "./dictionary.js";
import { c, ce } from "../log.js";

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;

  for (const entry of SKILL_DICTIONARY) {
    const result = await prisma.skill.upsert({
      where: { name: entry.name },
      create: {
        name: entry.name,
        category: entry.category,
        aliases: entry.aliases,
        isCanonical: true,
      },
      update: {
        category: entry.category,
        aliases: entry.aliases,
        isCanonical: true,
      },
    });
    // Простой счётчик: upsert не различает create/update — считаем по updatedAt
    if (result.updatedAt.getTime() - result.createdAt.getTime() < 1000) created++;
    else updated++;
  }

  console.log(`[seed] словарь загружен: ${c.bold(String(SKILL_DICTIONARY.length))} навыков ${c.dim(`(created≈${created})`)}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(ce.red("[seed] ошибка:"), err);
  process.exit(1);
});
