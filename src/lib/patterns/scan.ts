/** Скан паттернов по БД и работа с находками (применить метку / отклонить). */
import { prisma } from "../db";
import type { FlowTransfer } from "../graph/types";
import { DEFAULT_DETECT_CONFIG, scanPatterns, type DetectConfig } from "./detect";

/** Больше строк скан не читает — защита памяти; самые свежие переводы важнее. */
const MAX_ROWS = 300_000;

export const PATTERN_TAG = { FAN_OUT: "рассылка", FAN_IN: "сбор", LOOP: "кольцо" } as const;

export async function loadTransfers(days: number): Promise<{ transfers: FlowTransfer[]; truncated: boolean }> {
  const rows = await prisma.$queryRaw<{ txHash: string; from: string; to: string; amount: number; ts: number }[]>`
    SELECT "txHash", "fromAddress" AS "from", "toAddress" AS "to", amount::float8 AS amount,
           (extract(epoch FROM "blockTimestamp") * 1000)::float8 AS ts
    FROM "Transfer"
    WHERE "blockTimestamp" >= now() - make_interval(days => ${days}::int)
    ORDER BY "blockTimestamp" DESC
    LIMIT ${MAX_ROWS}`;
  return { transfers: rows, truncated: rows.length === MAX_ROWS };
}

export interface ScanResult {
  scanned: number;
  found: number;
  created: number;
  truncated: boolean;
  durationMs: number;
}

export async function scanAndStore(days = 7, cfg: DetectConfig = DEFAULT_DETECT_CONFIG): Promise<ScanResult> {
  const started = Date.now();
  const { transfers, truncated } = await loadTransfers(days);
  const findings = scanPatterns(transfers, cfg);
  let created = 0;

  for (const f of findings) {
    const existing = await prisma.patternFinding.findUnique({ where: { key: f.key }, select: { id: true } });
    const data = {
      address: f.address,
      addresses: f.addresses,
      score: f.score,
      summary: f.summary,
      metrics: JSON.parse(JSON.stringify(f.metrics)),
    };
    if (existing) {
      await prisma.patternFinding.update({ where: { id: existing.id }, data: { ...data, lastSeen: new Date() } });
    } else {
      await prisma.patternFinding.create({ data: { ...data, type: f.type, key: f.key } });
      created++;
    }
  }
  // Новые находки, которые не подтверждаются дольше окна скана, устарели (подтверждённые/отклонённые не трогаем)
  await prisma.patternFinding.deleteMany({
    where: { status: "NEW", lastSeen: { lt: new Date(started - days * 86_400_000) } },
  });
  await prisma.syncState.upsert({
    where: { key: "pattern_scan" },
    create: { key: "pattern_scan", value: JSON.stringify({ at: Date.now(), found: findings.length, created, days }) },
    update: { value: JSON.stringify({ at: Date.now(), found: findings.length, created, days }) },
  });
  return { scanned: transfers.length, found: findings.length, created, truncated, durationMs: Date.now() - started };
}

/** Применить находку: метка паттерна на все её адреса (адреса вне книги добавляются как неотслеживаемые). */
export async function applyFinding(id: number) {
  const f = await prisma.patternFinding.findUniqueOrThrow({ where: { id } });
  const tag = PATTERN_TAG[f.type];
  const label = await prisma.label.upsert({ where: { name: tag }, create: { name: tag, source: "AUTO" }, update: {} });
  for (const address of new Set(f.addresses)) {
    const wallet = await prisma.wallet.upsert({
      where: { address },
      create: { address, label: `${address.slice(0, 6)}…${address.slice(-4)}`, isWatched: false },
      update: {},
    });
    await prisma.walletLabel.upsert({
      where: { walletId_labelId: { walletId: wallet.id, labelId: label.id } },
      create: { walletId: wallet.id, labelId: label.id },
      update: {},
    });
  }
  return prisma.patternFinding.update({ where: { id }, data: { status: "APPLIED" } });
}

export async function setFindingStatus(id: number, status: "NEW" | "DISMISSED") {
  return prisma.patternFinding.update({ where: { id }, data: { status } });
}
