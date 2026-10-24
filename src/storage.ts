// Персист parsed-данных вакансий в Postgres (идемпотентные upsert по djinni id).
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import type { ParsedListItem } from "./parser/parse-list.js";
import type { ParsedDetail } from "./parser/parse-detail.js";

/** Upsert вакансии с данными страницы списка. Возвращает {isNew}. */
export async function upsertJobFromList(
  item: ParsedListItem,
  rawListHtmlPath: string | null,
): Promise<{ isNew: boolean }> {
  const existing = await prisma.jobPosting.findUnique({ where: { id: item.id } });

  const data: Pick<Prisma.JobPostingUpsertInput, "create" | "update"> = {
    create: {
      id: item.id,
      slug: item.slug,
      url: item.url,
      title: item.title,
      company: item.company,
      logoUrl: item.logoUrl,
      category: item.category,
      industry: item.industry,
      description: item.description,
      descriptionHtml: item.descriptionHtml,
      datePosted: item.datePosted,
      validThrough: item.validThrough,
      employmentType: item.employmentType,
      experienceYears: item.experienceYears,
      workFormat: item.workFormat,
      englishLevel: item.englishLevel,
      location: item.location,
      countries: item.countries,
      salaryTier: item.salaryTier,
      rawListHtmlPath,
      listCachedAt: new Date(),
      parsedAt: new Date(),
      status: "ACTIVE",
    },
    update: {
      slug: item.slug,
      url: item.url,
      title: item.title,
      company: item.company,
      logoUrl: item.logoUrl,
      category: item.category,
      industry: item.industry,
      description: item.description,
      descriptionHtml: item.descriptionHtml,
      datePosted: item.datePosted,
      validThrough: item.validThrough,
      employmentType: item.employmentType,
      experienceYears: item.experienceYears,
      workFormat: item.workFormat,
      englishLevel: item.englishLevel,
      location: item.location,
      countries: item.countries,
      salaryTier: item.salaryTier,
      rawListHtmlPath,
      listCachedAt: new Date(),
      parsedAt: new Date(),
      status: "ACTIVE",
    },
  };

  await prisma.jobPosting.upsert({ where: { id: item.id }, ...data });
  return { isNew: !existing };
}

/** Обновить вакансию данными detail-страницы (богатые поля). */
export async function updateJobFromDetail(
  detail: ParsedDetail,
  rawDetailHtmlPath: string | null,
): Promise<void> {
  await prisma.jobPosting.upsert({
    where: { id: detail.id },
    create: {
      id: detail.id,
      slug: detail.slug,
      url: detail.url,
      title: detail.title,
      company: detail.company,
      category: detail.category,
      industry: detail.industry,
      domain: detail.domain,
      description: detail.description,
      descriptionHtml: detail.descriptionHtml,
      datePosted: detail.datePosted,
      updatedAtDjinni: detail.updatedAtDjinni,
      validThrough: detail.validThrough,
      employmentType: detail.employmentType,
      experienceYears: detail.experienceYears,
      workFormat: detail.workFormat,
      englishLevel: detail.englishLevel,
      location: detail.location,
      countries: detail.countries,
      salaryTier: detail.salaryTier,
      salaryMin: detail.salaryMin,
      salaryMax: detail.salaryMax,
      salaryCurrency: detail.salaryCurrency,
      viewsCount: detail.viewsCount,
      repliesCount: detail.repliesCount,
      rawDetailHtmlPath,
      detailCachedAt: new Date(),
      parsedAt: new Date(),
      status: "ACTIVE",
    },
    update: {
      slug: detail.slug,
      domain: detail.domain,
      description: detail.description,
      descriptionHtml: detail.descriptionHtml,
      datePosted: detail.datePosted,
      updatedAtDjinni: detail.updatedAtDjinni,
      validThrough: detail.validThrough,
      employmentType: detail.employmentType,
      experienceYears: detail.experienceYears,
      workFormat: detail.workFormat,
      englishLevel: detail.englishLevel,
      location: detail.location,
      countries: detail.countries,
      salaryTier: detail.salaryTier,
      salaryMin: detail.salaryMin,
      salaryMax: detail.salaryMax,
      salaryCurrency: detail.salaryCurrency,
      viewsCount: detail.viewsCount,
      repliesCount: detail.repliesCount,
      rawDetailHtmlPath,
      detailCachedAt: new Date(),
      parsedAt: new Date(),
      status: "ACTIVE",
    },
  });
}
