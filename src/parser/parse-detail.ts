// Детерминированный парсер detail-страницы /jobs/<id>-<slug>/.
// Ключевые источники (cache/research/job-*.html):
// - script[type="application/ld+json"] — один объект JobPosting (полное описание, baseSalary);
// - блок «Необхідний досвід з навичками» / «Необхідні навички»:
//     div.detail-rows__line → name (навык) + value («3 роки»);
//     затем запятая-список доп. навыков + свёрнутый #more_skills_exp;
// - «Вимоги до володіння мовами» → Англійська → «C1 – Просунутий»;
// - #job-publication-info → «Опубліковано …», «Оновлено …», просмотры/отклики;
// - sidebar: опыт («Виключно від 10 років досвіду»), формат, локация, домен.
import * as cheerio from "cheerio";
import {
  cleanText,
  parseEnglishLevel,
  parseExperienceYears,
  parseUkrainianDate,
  parseWorkFormat,
  parseYearsValue,
  stripHtml,
} from "./normalize.js";

export interface StructuredSkill {
  name: string;
  yearsRequired: number | null;
  source: "DJINNI_STRUCTURED" | "DJINNI_EXTRA";
}

export interface ParsedDetail {
  id: number;
  slug: string | null;
  url: string;
  title: string;
  company: string | null;
  companyUrl: string | null;
  category: string | null;
  industry: string | null;
  domain: string | null;

  description: string | null;
  descriptionHtml: string | null;

  datePosted: Date | null;
  updatedAtDjinni: Date | null; // «Оновлено …» — драйвер TTL
  validThrough: Date | null;
  employmentType: string | null;
  experienceYears: number | null;
  workFormat: ReturnType<typeof parseWorkFormat>;
  englishLevel: ReturnType<typeof parseEnglishLevel>;
  location: string | null;
  countries: string[];

  salaryTier: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;

  viewsCount: number | null;
  repliesCount: number | null;

  skills: StructuredSkill[];
  unresolvedSkillCount: number; // сколько djinni-имён не разрешились в словаре (заполняет extract)
}

export function parseDetailPage(html: string, pageUrl: string): ParsedDetail | null {
  const $ = cheerio.load(html);

  // JSON-LD: один объект JobPosting
  let ld: Record<string, unknown> | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    try {
      const data = JSON.parse($(el).text()) as Record<string, unknown>;
      if (data["@type"] === "JobPosting") ld = data;
    } catch {
      /* усечённый JSON-LD пропускаем */
    }
  });

  // id + slug из canonical URL или JSON-LD url
  const canonical = $('link[rel="canonical"]').attr("href") ?? pageUrl;
  const id = extractId(canonical, $);
  if (id === null) return null;
  const slug = extractSlug(canonical);

  const title =
    cleanText($('h1').first().text()) ||
    (typeof ld?.title === "string" ? ld.title : null) ||
    `Job ${id}`;

  // Компания: ссылка вида /jobs/company-<slug>/ (не /companies/)
  const companyLink = $('a[href*="/jobs/company-"]').first();
  const company =
    cleanText(companyLink.text()) ||
    (ld?.hiringOrganization && typeof ld.hiringOrganization === "object"
      ? cleanText(String((ld.hiringOrganization as Record<string, unknown>).name ?? ""))
      : null) ||
    null;
  const companySlug = (companyLink.attr("href") ?? "").match(/\/jobs\/company-([^/]+)\/?/)?.[1] ?? null;
  const companyUrl = companySlug ? `https://djinni.co/jobs/company-${companySlug}/` : null;

  // Описание: JSON-LD полное; fallback — div.job-post__description (HTML)
  const ldDescription = typeof ld?.description === "string" ? ld.description : null;
  const descHtml = $("div.job-post__description").first().html();
  const description = ldDescription ?? (descHtml ? stripHtml(descHtml) : null);
  const descriptionHtml = descHtml ?? null;

  // Skills-блок: ищем заголовок «навичками»/«навички», затем detail-rows + доп. списки
  const skills = parseSkillsBlock($);

  // Английский из блока «Вимоги до володіння мовами»
  const englishLevel = parseEnglishFromLanguages($);

  // #job-publication-info: опубліковано/обновлено/просмотры/отклики.
  // Дата публикации: DOM «Опубліковано …» приоритетнее JSON-LD datePosted!
  // Проверено на кэше (236 страниц): у ~40% обновлённых вакансий Djinni
  // перезаписывает JSON-LD datePosted датой последнего обновления («Оновлено …»),
  // теряя исходную дату публикации. JSON-LD — только fallback (усечённый HTML).
  const pubInfo = $("#job-publication-info").text();
  const datePosted =
    parseUkrainianDate(extractAfter(pubInfo, "Опубліковано") ?? "") ??
    (typeof ld?.datePosted === "string" ? safeDate(ld.datePosted) : null);
  const updatedRaw = extractAfter(pubInfo, "Оновлено");
  const updatedAtDjinni = updatedRaw ? parseUkrainianDate(updatedRaw) : null;
  const { viewsCount, repliesCount } = parseStats(pubInfo);

  // Sidebar: опыт/формат/локация/домен
  const sidebar = $("aside").text();
  const experienceYears =
    parseExperienceYears(sidebar) ??
    (ld?.experienceRequirements && typeof ld.experienceRequirements === "object"
      ? monthsToYears((ld.experienceRequirements as Record<string, unknown>).monthsOfExperience)
      : null);
  const workFormat = parseWorkFormat(sidebar);
  const location = cleanText($("aside span.location-text").first().text()) || null;
  const domain = extractDomain(sidebar);

  // Зарплата: JSON-LD baseSalary (иногда есть)
  const salary = parseBaseSalary(ld?.baseSalary);
  const salaryTier = parseSalaryTierFromDom($);

  const validThrough =
    typeof ld?.validThrough === "string" ? safeDate(ld.validThrough) : null;
  const employmentType = typeof ld?.employmentType === "string" ? ld.employmentType : null;
  const category = typeof ld?.category === "string" ? ld.category : null;
  const industry = typeof ld?.industry === "string" ? ld.industry : null;
  const countries = extractCountries(ld);

  return {
    id,
    slug,
    url: canonical,
    title,
    company: company || null,
    companyUrl,
    category,
    industry,
    domain,
    description,
    descriptionHtml,
    datePosted,
    updatedAtDjinni,
    validThrough,
    employmentType,
    experienceYears,
    workFormat,
    englishLevel,
    location,
    countries,
    salaryTier,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    viewsCount,
    repliesCount,
    skills,
    unresolvedSkillCount: 0,
  };
}

/**
 * Skills-блок djinni:
 * 1) div.detail-rows__line → span.detail-rows__name + span.detail-rows__value («3 роки»)
 *    — must-have навыки с указанием опыта (DJINNI_STRUCTURED);
 * 2) после detail-rows — запятая-список доп. навыков (DJINNI_EXTRA);
 * 3) свёрнутый div#more_skills_exp — ещё доп. навыков (DJINNI_EXTRA).
 *
 * Важно: h2 «…навичками» и его содержимое — соседи внутри col-lg-8; блок языков —
 * отдельный соседний div. Поэтому scope = первый div-сосед после h2 (а не parent()).
 */
function parseSkillsBlock($: cheerio.CheerioAPI): StructuredSkill[] {
  const skills: StructuredSkill[] = [];
  const seen = new Set<string>();

  const add = (rawName: string, years: number | null, source: StructuredSkill["source"]): void => {
    const name = cleanText(rawName);
    if (!name || name.length > 60) return; // мусор из-за деградации разметки
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    skills.push({ name, yearsRequired: years, source });
  };

  $("h2").each((_, h) => {
    const heading = cleanText($(h).text()).toLowerCase();
    if (!/навичк/.test(heading)) return;
    if (/мовами|мови\b/.test(heading)) return; // блок языков — отдельно

    // Scope: первый div-сосед после заголовка (div.mb-3 со skills).
    // Второй сосед — обёртка блока языков, её НЕ берём (иначе «Англійска» → skill).
    const section = $(h).nextAll("div").first();
    if (section.length === 0) return;
    {
      // 1) структурированные строки
      section.find("div.detail-rows__line").each((___, line) => {
        const name = cleanText($(line).find("span.detail-rows__name").text());
        const value = cleanText($(line).find("span.detail-rows__value").text());
        add(name, parseYearsValue(value), "DJINNI_STRUCTURED");
      });
      // 2) доп. навыки: span-списки вне detail-rows и вне more_skills_exp
      section
        .find("span")
        .each((___, sp) => {
          if ($(sp).closest("div.detail-rows").length > 0) return; // это name/value строк
          if ($(sp).closest("div#more_skills_exp").length > 0) return; // обработано ниже
          const text = cleanText($(sp).text());
          if (!text || text.length > 500) return;
          if (/^\+\s*ще\s*\d+/i.test(text)) return; // заглушка fold-toggle
          for (const part of text.split(",")) add(part, null, "DJINNI_EXTRA");
        });
      // 3) свёрнутый блок more_skills_exp
      section
        .find("div#more_skills_exp span")
        .each((___, sp) => {
          const text = cleanText($(sp).text());
          if (!text || text.length > 500) return;
          for (const part of text.split(",")) add(part, null, "DJINNI_EXTRA");
        });
    }
  });

  return skills;
}

function parseEnglishFromLanguages($: cheerio.CheerioAPI): ReturnType<typeof parseEnglishLevel> {
  let level: ReturnType<typeof parseEnglishLevel> = "UNKNOWN";
  $("h2").each((_, h) => {
    if (level !== "UNKNOWN") return;
    const heading = cleanText($(h).text()).toLowerCase();
    if (!/мовами|мови\b/.test(heading)) return;
    // Scope: div-соседи после заголовка языков
    $(h)
      .nextAll("div")
      .slice(0, 2)
      .each((__, section) => {
        if (level !== "UNKNOWN") return;
        $(section)
          .find("div.detail-rows__line")
          .each((___, line) => {
            if (level !== "UNKNOWN") return;
            const name = cleanText($(line).find("span.detail-rows__name").text()).toLowerCase();
            if (!/англійськ|english/.test(name)) return;
            const value = cleanText($(line).find("span.detail-rows__value").text());
            level = parseEnglishLevel(value);
          });
      });
  });
  return level;
}

function parseStats(pubInfo: string): { viewsCount: number | null; repliesCount: number | null } {
  // «За весь час: 210 переглядів · 20 відгуків» (приоритет) или «55 переглядів · 4 відгуки».
  // \S* вместо \w* — \w не понимает кириллицу («переглядів»).
  const allTime = pubInfo.match(/За весь час:\s*(\d[\d\s]*)\s*перегляд\S*\s*·\s*(\d[\d\s]*)\s*відгук\S*/);
  const m = allTime ?? pubInfo.match(/(\d[\d\s]*)\s*перегляд\S*\s*·\s*(\d[\d\s]*)\s*відгук\S*/);
  if (!m) return { viewsCount: null, repliesCount: null };
  return {
    viewsCount: parseCount(m[1]),
    repliesCount: parseCount(m[2]),
  };
}

function parseCount(text: string): number | null {
  const n = Number.parseInt(text.replace(/\s/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function extractAfter(text: string, marker: string): string | null {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  return text.slice(idx, idx + 60);
}

function extractDomain(sidebar: string): string | null {
  const m = sidebar.match(/Домен:\s*([^\n]{1,80})/);
  return m ? cleanText(m[1]) : null;
}

function parseBaseSalary(base: unknown): { min: number; max: number; currency: string } | null {
  if (!base || typeof base !== "object") return null;
  const obj = base as Record<string, unknown>;
  const value = obj.value as Record<string, unknown> | undefined;
  if (!value || typeof value !== "object") return null;
  const min = typeof value.minValue === "number" ? value.minValue : null;
  const max = typeof value.maxValue === "number" ? value.maxValue : null;
  const currency = typeof obj.currency === "string" ? obj.currency : "USD";
  if (min === null && max === null) return null;
  return { min: min ?? max ?? 0, max: max ?? min ?? 0, currency };
}

function parseSalaryTierFromDom($: cheerio.CheerioAPI): string | null {
  const text = $('span[title*="Рівень зарплати"]').first().text().trim();
  const m = text.match(/^\$+/);
  return m ? m[0] : null;
}

function extractId(canonical: string, $: cheerio.CheerioAPI): number | null {
  const m = canonical.match(/\/jobs\/(\d+)/);
  if (m) return Number.parseInt(m[1], 10);
  // fallback: og:url
  const og = $('meta[property="og:url"]').attr("content") ?? "";
  const m2 = og.match(/\/jobs\/(\d+)/);
  return m2 ? Number.parseInt(m2[1], 10) : null;
}

function extractSlug(canonical: string): string | null {
  const m = canonical.match(/\/jobs\/\d+-([^/]+)\/?/);
  return m ? m[1] : null;
}

function monthsToYears(months: unknown): number | null {
  if (typeof months !== "number") return null;
  return Math.round((months / 12) * 10) / 10;
}

function extractCountries(ld: Record<string, unknown> | undefined): string[] {
  if (!ld) return [];
  const countries = new Set<string>();
  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.addressCountry === "string") countries.add(obj.addressCountry);
    for (const key of ["jobLocation", "applicantLocationRequirements", "address"]) {
      const child = obj[key];
      if (Array.isArray(child)) child.forEach(collect);
      else collect(child);
    }
  };
  collect(ld.jobLocation);
  collect(ld.applicantLocationRequirements);
  return [...countries];
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
