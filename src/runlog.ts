import { prisma } from "./db.js";
import { c } from "./log.js";
import type { RunType } from "@prisma/client";

// Хелпер RunLog: каждая итерация скрейпа/парсинга/аналитики — одна запись.
export class RunTracker {
  private readonly id: number;
  private requestsMade = 0;
  private pagesFetched = 0;
  private pagesCacheHit = 0;
  private jobsNew = 0;
  private jobsUpdated = 0;
  private jobsRefetched = 0;
  private skillsLinked = 0;

  private constructor(id: number) {
    this.id = id;
  }

  static async start(type: RunType): Promise<RunTracker> {
    const run = await prisma.runLog.create({ data: { type } });
    console.log(`${c.dim(`[run ${run.id}]`)} start ${type}`);
    return new RunTracker(run.id);
  }

  countRequest(): void {
    this.requestsMade++;
  }

  countPageFetched(): void {
    this.pagesFetched++;
  }

  countPageCacheHit(): void {
    this.pagesCacheHit++;
  }

  countJobsNew(n: number): void {
    this.jobsNew += n;
  }

  countJobsUpdated(n: number): void {
    this.jobsUpdated += n;
  }

  countJobsRefetched(n: number): void {
    this.jobsRefetched += n;
  }

  countSkillsLinked(n: number): void {
    this.skillsLinked += n;
  }

  async finish(error?: unknown): Promise<void> {
    const failed = error !== undefined && error !== null;
    await prisma.runLog.update({
      where: { id: this.id },
      data: {
        finishedAt: new Date(),
        status: failed ? "ERROR" : "OK",
        error: failed ? String(error instanceof Error ? error.stack ?? error.message : error) : null,
        pagesFetched: this.pagesFetched,
        pagesCacheHit: this.pagesCacheHit,
        jobsNew: this.jobsNew,
        jobsUpdated: this.jobsUpdated,
        jobsRefetched: this.jobsRefetched,
        skillsLinked: this.skillsLinked,
        requestsMade: this.requestsMade,
      },
    });
    console.log(
      `${c.dim(`[run ${this.id}]`)} finish: ${failed ? c.red("ERROR") : c.green("OK")} ` +
        `pages=${this.pagesFetched} cacheHit=${this.pagesCacheHit} ` +
        `new=${c.green(String(this.jobsNew))} updated=${this.jobsUpdated} refetched=${this.jobsRefetched} ` +
        `skills=${c.bold(String(this.skillsLinked))} requests=${this.requestsMade}`,
    );
  }
}
