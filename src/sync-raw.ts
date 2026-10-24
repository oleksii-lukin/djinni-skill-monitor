// Импорт локального файлового кэша в сторедж: pnpm raw:sync
// Переносит cache/scrape/{list,detail}/*.html и cache/list-state.json в
// RAW_STORE (обычно БД), сохраняя mtime файла как fetchedAt и проставляя
// db://raw/<id>-ссылки в raw*-поля JobPosting. Повторный запуск идемпотентен
// (дедуп по sha256).
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { createRawStore, type ListCacheStateData } from "./storage/raw-store.js";
import { c, ce } from "./log.js";

async function main(): Promise<void> {
  const store = createRawStore();
  if (config.rawStore === "fs") {
    console.warn(ce.yellow("[sync] RAW_STORE=fs — импорт в файловый сторедж бессмыслен (источник и есть файлы)"));
  }

  let imported = 0;
  let updatedRefs = 0;

  // Detail-страницы: ключ = id вакансии
  const detailFiles = await listHtml(path.join(config.cacheDir, "detail"));
  for (const file of detailFiles) {
    const externalKey = path.basename(file, ".html");
    const jobId = Number.parseInt(externalKey, 10);
    if (Number.isNaN(jobId)) continue;

    const html = await fs.readFile(file, "utf8");
    const fetchedAt = (await fs.stat(file)).mtime;
    const ref = await store.put("DETAIL", externalKey, `https://djinni.co/jobs/${externalKey}/`, html, fetchedAt);
    imported++;

    const job = await prisma.jobPosting.findUnique({ where: { id: jobId }, select: { rawDetailHtmlPath: true } });
    // Проставляем ссылку, только если поле пустое или указывало на этот же файл
    // (уже db://-ссылки не трогаем — БД могла быть наполнена другим источником)
    const current = job?.rawDetailHtmlPath ?? null;
    if (job && (!current || current === file || current.endsWith(`/${externalKey}.html`))) {
      if (current !== ref) {
        await prisma.jobPosting.update({ where: { id: jobId }, data: { rawDetailHtmlPath: ref } });
        updatedRefs++;
      }
    }
  }

  // Страницы списка: ключ = page-<N>
  const listFiles = await listHtml(path.join(config.cacheDir, "list"));
  for (const file of listFiles) {
    const externalKey = path.basename(file, ".html"); // page-3
    const html = await fs.readFile(file, "utf8");
    const fetchedAt = (await fs.stat(file)).mtime;
    await store.put("LIST", externalKey, `${config.baseUrl}/jobs/?page=${externalKey.replace("page-", "")}`, html, fetchedAt);
    imported++;
  }

  // Состояние кэша списка (если есть)
  const stateRaw = await fs.readFile(path.join(config.cacheDir, "list-state.json"), "utf8").catch(() => null);
  if (stateRaw !== null) {
    const state = JSON.parse(stateRaw) as { ids: number[]; pagesFetched: number; fetchedAt: string };
    await store.saveListState({ ids: state.ids, pagesFetched: state.pagesFetched, fetchedAt: new Date(state.fetchedAt) });
    console.log(`[sync] list-state.json → сторедж ${c.green("OK")} (${state.ids.length} ids)`);
  }

  console.log(
    `[sync] готово: ${c.bold(String(imported))} страниц импортировано, ` +
      `${c.bold(String(updatedRefs))} rawDetailHtmlPath обновлено на db://-ссылки`,
  );
}

async function listHtml(dir: string): Promise<string[]> {
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".html"));
  return files.map((f) => path.join(dir, f));
}

main()
  .catch((err) => {
    console.error(ce.red("[sync] фатальная ошибка:"), err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
