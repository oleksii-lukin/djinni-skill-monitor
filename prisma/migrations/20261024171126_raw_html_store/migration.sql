-- CreateEnum
CREATE TYPE "RawPageKind" AS ENUM ('LIST', 'DETAIL');

-- CreateTable
CREATE TABLE "RawHtmlPage" (
    "id" SERIAL NOT NULL,
    "kind" "RawPageKind" NOT NULL,
    "externalKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "httpStatus" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawHtmlPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListCacheState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ids" INTEGER[],
    "pagesFetched" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListCacheState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawHtmlPage_kind_externalKey_key" ON "RawHtmlPage"("kind", "externalKey");
