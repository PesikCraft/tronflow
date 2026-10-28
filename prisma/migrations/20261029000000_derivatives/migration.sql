-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'DERIVATIVES';

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "exchange" VARCHAR(16) NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "oiUsd" DOUBLE PRECISION NOT NULL,
    "funding8h" DOUBLE PRECISION NOT NULL,
    "volume24hUsd" DOUBLE PRECISION NOT NULL,
    "change24hPct" DOUBLE PRECISION NOT NULL,
    "liqLongUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liqShortUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSnapshot_takenAt_idx" ON "MarketSnapshot"("takenAt");
