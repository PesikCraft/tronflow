-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('WHALE', 'VOLUME_SPIKE', 'NEW_COUNTERPARTY', 'PATTERN');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PatternType" AS ENUM ('FAN_OUT', 'FAN_IN', 'LOOP');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('NEW', 'APPLIED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" SERIAL NOT NULL,
    "type" "AlertType" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownMin" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" BIGSERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternFinding" (
    "id" SERIAL NOT NULL,
    "type" "PatternType" NOT NULL,
    "key" VARCHAR(300) NOT NULL,
    "address" VARCHAR(34) NOT NULL,
    "addresses" TEXT[],
    "score" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'NEW',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_ruleId_dedupeKey_key" ON "AlertEvent"("ruleId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PatternFinding_key_key" ON "PatternFinding"("key");

-- CreateIndex
CREATE INDEX "PatternFinding_status_score_idx" ON "PatternFinding"("status", "score");

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Стартовые правила (можно менять и отключать в разделе «Уведомления»)
INSERT INTO "AlertRule" ("type", "name", "params", "cooldownMin", "updatedAt") VALUES
  ('WHALE', 'Крупный перевод от 20 000 USDT', '{"minAmount": 20000}', 0, now()),
  ('VOLUME_SPIKE', 'Всплеск объёма за 30 минут', '{"windowMin": 30, "spikePct": 100, "minVolume": 10000, "baselineDays": 7}', 60, now()),
  ('NEW_COUNTERPARTY', 'Новый адрес от 5 000 USDT', '{"minAmount": 5000}', 0, now()),
  ('PATTERN', 'Новый паттерн: рассылка, сбор, кольцо', '{"patternTypes": ["FAN_OUT", "FAN_IN", "LOOP"], "minScore": 0.6}', 0, now());
