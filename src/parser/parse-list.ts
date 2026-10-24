// Детерминированный парсер страницы списка /jobs/?page=N.
// Источники данных (cache/research/jobs-list-*.html):
// - div.job-item[id="job-item-<id>"] — заголовок, компания, тир зарплаты, метаданные;
// - span.js-original-text — полное HTML-описание вакансии;
// - script[type="application/ld+json"] — МАССИВ schema.org/JobPosting в <head>.
import * as cheerio from "cheerio";
import { parseEnglishLevel, parseExperienceYears, parseWorkFormat, stripHtml } from "./normalize.js";

export interface ParsedListItem {
  id: number;
  slug: string | null;
  url: string;
  title: string;
  company: string | null;
  logoUrl: string | null;
  category: string | null;
  industry: string | null;
  datePosted: Date | null;
  validThrough: Date | null;
  employmentType: string | null;
  experienceYears: number | null;
  workFormat: ReturnType<typeof parseWorkFormat>;
  englishLevel: ReturnType<typeof parseEnglishLevel>;
  location: string | null;
  countries: string[];
  salaryTier: string | null;
  descriptionHtml: string | null;
  description: string | null;
}

export interface ListPageResult {
  items: ParsedListItem[];
  jsonLdCount: number;
  /** Общий счётчик «Вакансії» из заголовка страницы (с фильтром, напр. 256; без — ~6135). */
  totalCount?: number;
}

export function parseListPage(html: string, sourceUrl: string): ListPageResult {
  const $ = cheerio.load(html);

  // JSON-LD массив JobPosting — индекс по id для обогащения
  const jsonLdById = new Map<number, Record<string, unknown>>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // усечённый/битый JSON-LD не критичен
    }
    const arr = Array.isArray(data) ? data : [data];
    for (const obj of arr) {
      const job = obj as Record<string, unknown>;
      if (job["@type"] !== "JobPosting") continue;
      const id = typeof job.identifier === "number" ? job.identifier : null;
      if (id !== null) jsonLdById.set(id, job);
    }
  });

  const items: ParsedListItem[] = [];
  const seen = new Set<number>();

  $('div.job-item[id^="job-item-"]').each((_, el) => {
    const item = parseJobItem($(el), jsonLdById);
    if (!item) return;
    if (seen.has(item.id)) return; // дубли на странице
    seen.add(item.id);
    items.push(item);
  });

  // Общий счётчик: <header><h1>Вакансії на Djinni</h1><span class="fs-1 …">6135</span>
  const countRaw = $("header h1").first().next("span").text().trim();
  const parsedCount = Number.parseInt(countRaw.replace(/\s+/g, ""), 10);
  const totalCount = Number.isFinite(parsedCount) ? parsedCount : undefined;

  return { items, jsonLdCount: jsonLdById.size, totalCount };
}

function parseJobItem(
  root: ReturnType<cheerio.CheerioAPI>,
  jsonLdById: Map<number, Record<string, unknown>>,
): ParsedListItem | null {
  const idAttr = root.attr("id") ?? ""; // job-item-854938
  const id = Number.parseInt(idAttr.replace("job-item-", ""), 10);
  if (Number.isNaN(id)) return null;

  // Ссылка на detail-страницу: <a href="/jobs/<id>-<slug>/"> внутри элемента
  const detailHref = root.find('a[href^="/jobs/"]').first().attr("href") ?? null;
  const url = detailHref ? new URL(detailHref, "https://djinni.co").toString() : `https://djinni.co/jobs/${id}/`;
  const slug = extractSlug(detailHref);

  const title = root.find("h2.job-item__position").first().text().trim() || null;
  const company = root.find("span.small.text-gray-800").first().text().trim() || null;
  const logoUrl = root.find("img.userpic-image_img").first().attr("src") ?? null;

  // Тир зарплаты: span с tooltip «Рівень зарплати…»
  const salaryTier = normalizeSalaryTier(
    root.find('span[title*="Рівень зарплати"]').first().text().trim(),
  );

  // Строка метаданных: формат · локация · стаж · английский
  const metaRow = root.find("div.fw-medium.d-flex.flex-wrap").first();
  const metaText = metaRow.text();
  const workFormat = parseWorkFormat(metaRow.find("span.text-nowrap").first().text() || metaText);
  const location = root.find("span.location-text").first().text().trim() || null;
  const experienceYears = parseExperienceYears(metaText);
  const englishLevel = parseEnglishLevel(metaText);

  // Полное описание — из js-original-text (HTML)
  const descriptionHtml = root.find("span.js-original-text").first().html();
  const description = descriptionHtml ? stripHtml(descriptionHtml) : null;

  // Обогащение из JSON-LD (может отсутствовать/быть усечённым)
  const ld = jsonLdById.get(id);
  const datePosted = ld && typeof ld.datePosted === "string" ? safeDate(ld.datePosted) : null;
  const validThrough = ld && typeof ld.validThrough === "string" ? safeDate(ld.validThrough) : null;
  const category = ld && typeof ld.category === "string" ? ld.category : null;
  const industry = ld && typeof ld.industry === "string" ? ld.industry : null;
  const employmentType = ld && typeof ld.employmentType === "string" ? ld.employmentType : null;
  const countries = extractCountries(ld);

  return {
    id,
    slug,
    url,
    title: title ?? `Job ${id}`,
    company,
    logoUrl,
    category,
    industry,
    datePosted,
    validThrough,
    employmentType,
    experienceYears:
      experienceYears ?? parseMonthsToYears(ld?.experienceRequirements),
    workFormat,
    englishLevel,
    location,
    countries,
    salaryTier,
    descriptionHtml,
    description,
  };
}

function extractSlug(href: string | null): string | null {
  if (!href) return null;
  const m = href.match(/\/jobs\/\d+-([^/]+)\/?/);
  return m ? m[1] : null;
}

function normalizeSalaryTier(text: string): string | null {
  const m = text.match(/^\$+/);
  return m ? m[0] : null;
}

function extractCountries(ld: Record<string, unknown> | undefined): string[] {
  if (!ld) return [];
  const countries = new Set<string>();

  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.addressCountry === "string") countries.add(obj.addressCountry);
    for (const key of ["jobLocation", "applicantLocationRequirements"]) {
      const child = obj[key];
      if (Array.isArray(child)) child.forEach(collect);
      else collect(child);
    }
    const addr = obj["address"];
    if (Array.isArray(addr)) addr.forEach(collect);
    else collect(addr);
  };

  collect(ld["jobLocation"]);
  collect(ld["applicantLocationRequirements"]);
  return [...countries];
}

function parseMonthsToYears(exp: unknown): number | null {
  if (!exp || typeof exp !== "object") return null;
  const months = (exp as Record<string, unknown>).monthsOfExperience;
  if (typeof months !== "number") return null;
  return Math.round((months / 12) * 10) / 10;
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
