-- CreateEnum
CREATE TYPE "RecruiterActivity" AS ENUM ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "RunType" ADD VALUE 'SCRAPE_COMPETITION';

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "recruiterActivity" "RecruiterActivity" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "recruiterLastResponseAt" TIMESTAMP(3),
ADD COLUMN     "recruiterResponseLabel" TEXT,
ADD COLUMN     "replies30d" INTEGER,
ADD COLUMN     "views30d" INTEGER;

-- CreateTable
CREATE TABLE "JobApplicantStats" (
    "jobId" INTEGER NOT NULL,
    "totalApplicants" INTEGER NOT NULL,
    "experienceDist" JSONB NOT NULL,
    "salaryDist" JSONB NOT NULL,
    "englishDist" JSONB NOT NULL,
    "topSkills" JSONB NOT NULL,
    "rawJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplicantStats_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE INDEX "JobApplicantStats_fetchedAt_idx" ON "JobApplicantStats"("fetchedAt");

-- AddForeignKey
ALTER TABLE "JobApplicantStats" ADD CONSTRAINT "JobApplicantStats_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
