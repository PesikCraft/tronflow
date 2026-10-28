-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'NEWS';

-- CreateEnum
CREATE TYPE "NewsSentiment" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "summary" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "assets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentiment" "NewsSentiment" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "impact" INTEGER NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");
