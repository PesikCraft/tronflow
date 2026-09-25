/**
 * Интеграционные тесты SQL-аналитики и ingestion на отдельной БД.
 *   TEST_DATABASE_URL=postgres://…/tronflow_test npm run test:integration
 * Тест очищает таблицы — никогда не указывайте боевую БД.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL не задан");
if (!/test/i.test(url)) throw new Error("TEST_DATABASE_URL должен указывать на тестовую БД (имя содержит 'test')");
process.env.DATABASE_URL = url;
process.env.ANALYTICS_TZ = "Asia/Yerevan";

execSync("npx prisma migrate deploy", { env: process.env, stdio: "ignore" });

const { prisma } = await import("../../src/lib/db");
const { saveTransfers, enqueueJob } = await import("../../src/lib/ingest");
const a = await import("../../src/lib/analytics");

const A = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // адреса только как идентификаторы
const B = "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G";
const X = "TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa";
const Y = "THTAs7MSsg8ZtjDvJyuRksKZ3mTsvhZQpC";
const now = Date.now();
const h = (hoursAgo: number) => now - hoursAgo * 3_600_000;

before(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "Transfer", "Wallet", "Label", "Job", "SyncState", "BalanceSnapshot" RESTART IDENTITY CASCADE`);
  await prisma.wallet.createMany({
    data: [
      { address: A, label: "Desk A", category: "OTC" },
      { address: B, label: "Exchanger B", category: "EXCHANGE" },
    ],
  });
  const inserted = await saveTransfers([
    { txHash: "a".repeat(64), blockTimestamp: h(1), from: X, to: A, amount: "1000" },
    { txHash: "b".repeat(64), blockTimestamp: h(2), from: A, to: Y, amount: "400.5" },
    { txHash: "c".repeat(64), blockTimestamp: h(3), from: A, to: B, amount: "250" }, // внутри книги
    { txHash: "d".repeat(64), blockTimestamp: h(50), from: X, to: B, amount: "5000" }, // старше 1d
    { txHash: "e".repeat(64), blockTimestamp: h(4), from: Y, to: X, amount: "999" }, // не касается книги
    { txHash: "f".repeat(64), blockTimestamp: h(5), from: X, to: A, amount: "0" }, // poisoning — отбрасывается
  ]);
  assert.equal(inserted, 5);
});

after(async () => {
  await prisma.$disconnect();
});

test("timestamps round-trip exactly regardless of server timezone", async () => {
  const [row] = await prisma.$queryRaw<{ ms: number }[]>`
    SELECT (extract(epoch FROM "blockTimestamp") * 1000)::float8 AS ms FROM "Transfer" WHERE "txHash" = ${"a".repeat(64)}`;
  assert.equal(Math.round(row.ms), Math.round(h(1)));
  const viaModel = await prisma.transfer.findFirstOrThrow({ where: { txHash: "a".repeat(64) } });
  assert.equal(viaModel.blockTimestamp.getTime(), Math.round(h(1)));
});

test("ingestion is idempotent", async () => {
  const again = await saveTransfers([{ txHash: "a".repeat(64), blockTimestamp: h(1), from: X, to: A, amount: "1000.000000" }]);
  assert.equal(again, 0);
});

test("summary 1d: internal transfers are not double counted", async () => {
  const s = await a.getSummary("1d");
  assert.equal(s.txCount, 3);
  assert.equal(s.totalVolume, 1650.5);
  assert.equal(s.inflow, 1000);
  assert.equal(s.outflow, 400.5);
  assert.equal(s.internal, 250);
  assert.equal(s.uniqueCounterparties, 2); // X и Y
  assert.equal(s.medianSize, 400.5);
});

test("summary 7d includes older transfer; scope by single address", async () => {
  assert.equal((await a.getSummary("7d")).totalVolume, 6650.5);
  const onlyB = await a.getSummary("7d", [B]);
  assert.equal(onlyB.inflow, 5250);
  assert.equal(onlyB.txCount, 2);
});

test("activity profile is zero-filled and uses local timezone", async () => {
  const hours = await a.getActivityProfile("1d", "hour");
  assert.equal(hours.length, 24);
  const yerevanHour = Number(new Date(h(1)).toLocaleString("en-US", { timeZone: "Asia/Yerevan", hour: "numeric", hourCycle: "h23" }));
  assert.ok(hours.find((b) => b.key === yerevanHour)!.volume >= 1000);
  assert.equal((await a.getActivityProfile("7d", "isodow")).length, 7);
});

test("volume series is zero-filled over the whole period", async () => {
  const days = await a.getVolumeSeries("7d");
  assert.ok(days.length === 7 || days.length === 8, `7d -> ${days.length} buckets`);
  assert.equal(days.reduce((s, b) => s + b.volume, 0), 6650.5);
  const hours = await a.getVolumeSeries("1d");
  assert.ok(hours.length >= 24 && hours.length <= 25);
  assert.equal(hours.reduce((s, b) => s + b.count, 0), 3);
});

test("wallet stats per address", async () => {
  const rows = await a.getWalletStats("7d");
  const desk = rows.find((r) => r.address === A)!;
  assert.deepEqual([desk.inflow, desk.outflow, desk.txCount, desk.counterparties], [1000, 650.5, 3, 3]);
});

test("top counterparties and transfer listing", async () => {
  const cps = await a.getTopCounterparties(A, "7d");
  assert.equal(cps[0].address, X);
  assert.equal(cps.find((c) => c.address === B)?.label, "Exchanger B");
  const list = await a.getTransfers({ address: A, limit: 2 });
  assert.equal(list.length, 2);
  assert.ok(list[0].blockTimestamp >= list[1].blockTimestamp);
});

test("graph data: global and focused neighbourhood", async () => {
  const g = await a.getGraphData("7d");
  assert.equal(g.transfers.length, 5);
  const focused = await a.getGraphData("7d", { focus: Y });
  // окрестность Y = {Y, A, X}; переводы, касающиеся любого из них
  assert.ok(focused.transfers.every((t) => [Y, A, X].includes(t.from) || [Y, A, X].includes(t.to)));
  assert.ok(focused.wallets.some((w) => w.address === A));
});

test("job queue deduplicates pending jobs", async () => {
  const j1 = await enqueueJob("SYNC", A);
  const j2 = await enqueueJob("SYNC", A);
  assert.equal(j1.id, j2.id);
});

test("system status", async () => {
  const s = await a.getSystemStatus();
  assert.equal(s.worker, null);
  assert.equal(s.pendingBackfills, 2);
  assert.equal(s.pendingJobs, 1);
});
