-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkFormat" AS ENUM ('REMOTE', 'HYBRID', 'OFFICE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EnglishLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'ADVANCED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('LANGUAGE', 'FRONTEND', 'BACKEND', 'DATABASE', 'CLOUD', 'DEVOPS', 'TOOL', 'TESTING', 'DOMAIN', 'CONCEPT', 'OTHER');

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('DJINNI_STRUCTURED', 'DJINNI_EXTRA', 'DESCRIPTION_KEYWORD');

-- CreateEnum
CREATE TYPE "RunType" AS ENUM ('SCRAPE_LIST', 'SCRAPE_DETAIL', 'SCRAPE_RUN', 'PARSE_CACHED', 'ANALYSIS_EXPORT', 'ANALYSIS_STATS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('OK', 'ERROR');

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" INTEGER NOT NULL,
    "slug" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "logoUrl" TEXT,
    "category" TEXT,
    "industry" TEXT,
    "domain" TEXT,
    "description" TEXT,
    "descriptionHtml" TEXT,
    "datePosted" TIMESTAMP(3),
    "validThrough" TIMESTAMP(3),
    "updatedAtDjinni" TIMESTAMP(3),
    "employmentType" TEXT,
    "workFormat" "WorkFormat" NOT NULL DEFAULT 'UNKNOWN',
    "location" TEXT,
    "countries" TEXT[],
    "experienceYears" DOUBLE PRECISION,
    "englishLevel" "EnglishLevel" NOT NULL DEFAULT 'UNKNOWN',
    "salaryTier" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT,
    "viewsCount" INTEGER,
    "repliesCount" INTEGER,
    "rawListHtmlPath" TEXT,
    "rawDetailHtmlPath" TEXT,
    "listCachedAt" TIMESTAMP(3),
    "detailCachedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "category" "SkillCategory" NOT NULL DEFAULT 'OTHER',
    "isCanonical" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkillRequirement" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "skillId" INTEGER NOT NULL,
    "source" "SkillSource" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "yearsRequired" DOUBLE PRECISION,
    "rawName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSkillRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" SERIAL NOT NULL,
    "type" "RunType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'OK',
    "error" TEXT,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "pagesCacheHit" INTEGER NOT NULL DEFAULT 0,
    "jobsNew" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "jobsRefetched" INTEGER NOT NULL DEFAULT 0,
    "skillsLinked" INTEGER NOT NULL DEFAULT 0,
    "requestsMade" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosting_datePosted_idx" ON "JobPosting"("datePosted");

-- CreateIndex
CREATE INDEX "JobPosting_detailCachedAt_idx" ON "JobPosting"("detailCachedAt");

-- CreateIndex
CREATE INDEX "JobPosting_status_idx" ON "JobPosting"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Skill_category_idx" ON "Skill"("category");

-- CreateIndex
CREATE INDEX "JobSkillRequirement_skillId_idx" ON "JobSkillRequirement"("skillId");

-- CreateIndex
CREATE INDEX "JobSkillRequirement_source_idx" ON "JobSkillRequirement"("source");

-- CreateIndex
CREATE UNIQUE INDEX "JobSkillRequirement_jobId_skillId_key" ON "JobSkillRequirement"("jobId", "skillId");

-- CreateIndex
CREATE INDEX "RunLog_startedAt_idx" ON "RunLog"("startedAt");

-- AddForeignKey
ALTER TABLE "JobSkillRequirement" ADD CONSTRAINT "JobSkillRequirement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkillRequirement" ADD CONSTRAINT "JobSkillRequirement_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
