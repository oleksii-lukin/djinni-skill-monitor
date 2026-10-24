// Сторедж сырого HTML страниц djinni (кэш скрейпа) с выбором бэкенда по env:
// - RAW_STORE=db (дефолт) — таблица RawHtmlPage в Postgres: общий кэш для команды,
//   ref-поле JobPosting хранит URI «db://raw/<id>»;
// - RAW_STORE=fs — файлы cache/scrape/{list,detail}/<key>.html (офлайн-фолбэк,
//   ref — обычный путь к файлу, как раньше).
//
// Хранится только последний снапшот на ключ (kind, externalKey): перезапись.
// Если HTML не изменился (sha256 совпал) — обновляется только fetchedAt.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { RawPageKind } from "@prisma/client";

export type { RawPageKind };

export interface ListCacheStateData {
  ids: number[];
  pagesFetched: number;
  fetchedAt: Date;
}

export interface RawStore {
  /** Сохранить снапшот страницы; fetchedAt — время захвата (для импорта из файлов). */
  put(
    kind: RawPageKind,
    externalKey: string,
    url: string,
    html: string,
    fetchedAt?: Date,
  ): Promise<string>;
  /** HTML снапшота или null, если не сохраняли. */
  get(kind: RawPageKind, externalKey: string): Promise<string | null>;
  /** Ref существующего снапшота без записи (pnpm parse обновляет поля, не меняя HTML). */
  getRef(kind: RawPageKind, externalKey: string): Promise<string | null>;
  /** Все ключи сохранённых снапшотов вида (для полного перепарсинга). */
  listKeys(kind: RawPageKind): Promise<string[]>;
  getListState(): Promise<ListCacheStateData | null>;
  saveListState(state: ListCacheStateData): Promise<void>;
}

export function createRawStore(): RawStore {
  return config.rawStore === "fs" ? new FsRawStore() : new DbRawStore();
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------- Postgres ----------

class DbRawStore implements RawStore {
  async put(
    kind: RawPageKind,
    externalKey: string,
    url: string,
    html: string,
    fetchedAt = new Date(),
  ): Promise<string> {
    const key = { kind, externalKey };
    const digest = sha256(html);
    const existing = await prisma.rawHtmlPage.findUnique({ where: { kind_externalKey: key } });

    if (existing?.sha256 === digest) {
      // Контент не изменился — только свежесть захвата
      await prisma.rawHtmlPage.update({
        where: { id: existing.id },
        data: { fetchedAt, url },
      });
      return dbRef(existing.id);
    }

    const row = await prisma.rawHtmlPage.upsert({
      where: { kind_externalKey: key },
      create: {
        kind,
        externalKey,
        url,
        html,
        sha256: digest,
        byteSize: Buffer.byteLength(html, "utf8"),
        fetchedAt,
      },
      update: {
        url,
        html,
        sha256: digest,
        byteSize: Buffer.byteLength(html, "utf8"),
        fetchedAt,
      },
    });
    return dbRef(row.id);
  }

  async get(kind: RawPageKind, externalKey: string): Promise<string | null> {
    const row = await prisma.rawHtmlPage.findUnique({
      where: { kind_externalKey: { kind, externalKey } },
      select: { html: true },
    });
    return row?.html ?? null;
  }

  async getRef(kind: RawPageKind, externalKey: string): Promise<string | null> {
    const row = await prisma.rawHtmlPage.findUnique({
      where: { kind_externalKey: { kind, externalKey } },
      select: { id: true },
    });
    return row ? dbRef(row.id) : null;
  }

  async listKeys(kind: RawPageKind): Promise<string[]> {
    const rows = await prisma.rawHtmlPage.findMany({
      where: { kind },
      select: { externalKey: true },
      orderBy: { externalKey: "asc" },
    });
    return rows.map((r) => r.externalKey);
  }

  async getListState(): Promise<ListCacheStateData | null> {
    const row = await prisma.listCacheState.findUnique({ where: { id: 1 } });
    return row ? { ids: row.ids, pagesFetched: row.pagesFetched, fetchedAt: row.fetchedAt } : null;
  }

  async saveListState(state: ListCacheStateData): Promise<void> {
    await prisma.listCacheState.upsert({
      where: { id: 1 },
      create: { id: 1, ...state },
      update: state,
    });
  }
}

function dbRef(id: number): string {
  return `db://raw/${id}`;
}

// ---------- Файловый фолбэк ----------

class FsRawStore implements RawStore {
  async put(
    kind: RawPageKind,
    externalKey: string,
    _url: string,
    html: string,
    _fetchedAt?: Date,
  ): Promise<string> {
    const filePath = this.filePath(kind, externalKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, html, "utf8");
    return filePath;
  }

  async get(kind: RawPageKind, externalKey: string): Promise<string | null> {
    return fs.readFile(this.filePath(kind, externalKey), "utf8").catch(() => null);
  }

  async getRef(kind: RawPageKind, externalKey: string): Promise<string | null> {
    const exists = await fs
      .stat(this.filePath(kind, externalKey))
      .then(() => true)
      .catch(() => false);
    return exists ? this.filePath(kind, externalKey) : null;
  }

  async listKeys(kind: RawPageKind): Promise<string[]> {
    const dir = this.dir(kind);
    const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) =>
      f.endsWith(".html"),
    );
    return files.map((f) => path.basename(f, ".html")).sort();
  }

  async getListState(): Promise<ListCacheStateData | null> {
    const raw = await fs
      .readFile(path.join(config.cacheDir, "list-state.json"), "utf8")
      .catch(() => null);
    if (raw === null) return null;
    const state = JSON.parse(raw) as { ids: number[]; pagesFetched: number; fetchedAt: string };
    return { ids: state.ids, pagesFetched: state.pagesFetched, fetchedAt: new Date(state.fetchedAt) };
  }

  async saveListState(state: ListCacheStateData): Promise<void> {
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(config.cacheDir, "list-state.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  }

  private dir(kind: RawPageKind): string {
    return path.join(config.cacheDir, kind.toLowerCase());
  }

  private filePath(kind: RawPageKind, externalKey: string): string {
    return path.join(this.dir(kind), `${externalKey}.html`);
  }
}
