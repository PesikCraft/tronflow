-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WalletCategory" AS ENUM ('EXCHANGE', 'OTC', 'TRADER', 'WHALE', 'SUSPICIOUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LabelSource" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SYNC', 'EXPAND', 'BALANCE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(34) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "category" "WalletCategory" NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "isWatched" BOOLEAN NOT NULL DEFAULT true,
    "usdtBalance" DECIMAL(38,6),
    "trxBalance" DECIMAL(38,6),
    "balanceUpdatedAt" TIMESTAMP(3),
    "syncCursor" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "backfilledAt" TIMESTAMP(3),
    "historyFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" VARCHAR(9) NOT NULL DEFAULT '#64748b',
    "source" "LabelSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLabel" (
    "walletId" INTEGER NOT NULL,
    "labelId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLabel_pkey" PRIMARY KEY ("walletId","labelId")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" BIGSERIAL NOT NULL,
    "txHash" CHAR(64) NOT NULL,
    "blockNumber" BIGINT,
    "blockTimestamp" TIMESTAMPTZ(3) NOT NULL,
    "fromAddress" VARCHAR(34) NOT NULL,
    "toAddress" VARCHAR(34) NOT NULL,
    "amount" DECIMAL(38,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "usdt" DECIMAL(38,6) NOT NULL,
    "trx" DECIMAL(38,6),
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "type" "JobType" NOT NULL,
    "address" VARCHAR(34) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_category_idx" ON "Wallet"("category");

-- CreateIndex
CREATE INDEX "Wallet_isWatched_idx" ON "Wallet"("isWatched");

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");

-- CreateIndex
CREATE INDEX "Transfer_fromAddress_blockTimestamp_idx" ON "Transfer"("fromAddress", "blockTimestamp");

-- CreateIndex
CREATE INDEX "Transfer_toAddress_blockTimestamp_idx" ON "Transfer"("toAddress", "blockTimestamp");

-- CreateIndex
CREATE INDEX "Transfer_blockTimestamp_idx" ON "Transfer"("blockTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_txHash_fromAddress_toAddress_amount_key" ON "Transfer"("txHash", "fromAddress", "toAddress", "amount");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_walletId_takenAt_idx" ON "BalanceSnapshot"("walletId", "takenAt");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletLabel" ADD CONSTRAINT "WalletLabel_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLabel" ADD CONSTRAINT "WalletLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

