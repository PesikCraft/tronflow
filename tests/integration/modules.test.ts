/**
 * Интеграционные тесты: ликвидность, уведомления, скан паттернов.
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
process.env.DASHBOARD_URL = "http://desk.local:3000";
delete process.env.TELEGRAM_BOT_TOKEN;

execSync("npx prisma migrate deploy", { env: process.env, stdio: "ignore" });

const { prisma } = await import("../../src/lib/db");
const { saveTransfers } = await import("../../src/lib/ingest");
const { getLiquidity } = await import("../../src/lib/liquidity");
const { runAlerts } = await import("../../src/lib/alerts/engine");
const { scanAndStore, applyFinding } = await import("../../src/lib/patterns/scan");
const { makeScenario } = await import("../fixtures/scenario");

// Адреса — просто идентификаторы (валидные base58)
const EX = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // обменник
const OTC = "TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G"; // OTC
const TR = "TU4vEruvZwLLkSfV9bNw12EJTPvNr7Pvaa"; // трейдер (не рынок)
const C1 = "THTAs7MSsg8ZtjDvJyuRksKZ3mTsvhZQpC";
const C2 = "TBHuKeFqtXCpkP5FAFRgEeQ7CeTqEf8kz3";
const NEWBIE = "TBuGAaJQhsFodsDMCinsybJ5Z5f7usZmRA";

let tx = 0;
const hash = () => (++tx).toString(16).padStart(64, "0");
const minAgo = (m: number) => Date.now() - m * 60_000;
const t = (from: string, to: string, amount: number, minutesAgo: number) => ({
  txHash: hash(),
  from,
  to,
  amount: String(amount),
  blockTimestamp: minAgo(minutesAgo),
});

before(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Transfer", "Wallet", "Label", "Job", "SyncState", "BalanceSnapshot", "AlertEvent", "PatternFinding", "AppSetting" RESTART IDENTITY CASCADE`,
  );
  const ready = new Date(Date.now() - 10 * 86_400_000);
  await prisma.wallet.createMany({
    data: [
      { address: EX, label: "Exchanger B", category: "EXCHANGE", usdtBalance: 100_000, backfilledAt: ready, historyFrom: ready },
      { address: OTC, label: "OTC Desk A", category: "OTC", usdtBalance: 50_000, backfilledAt: ready, historyFrom: ready },
      { address: TR, label: "Trader C", category: "TRADER", usdtBalance: 10_000, backfilledAt: ready, historyFrom: ready },
    ],
  });
  await saveTransfers([
    // история: 3 дня ровного фона, чтобы была норма
    ...Array.from({ length: 72 }, (_, i) => t(C1, EX, 1_000, 60 * (26 + i))),
    t(C1, EX, 5_000, 30), // последний час: приток 5 000
    t(C2, EX, 3_000, 90), // 4 ч: ещё приток
    t(EX, C2, 1_000, 120), // 4 ч: отток 1 000
    t(EX, OTC, 7_000, 60), // внутри рынка — не влияет на давление
    t(OTC, C1, 2_000, 600), // 24 ч: отток 2 000
    t(TR, C1, 9_999, 20), // трейдер вне «рынка»
  ]);
});

after(async () => {
  await prisma.$disconnect();
});

test("migration seeded default alert rules", async () => {
  const rules = await prisma.alertRule.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(
    rules.map((r) => r.type),
    ["WHALE", "VOLUME_SPIKE", "NEW_COUNTERPARTY", "PATTERN"],
  );
});

test("liquidity: windows, pressure, velocity", async () => {
  const l = await getLiquidity({ window: 4, range: "48h" });
  assert.equal(l.scope.kind, "market");
  assert.equal(l.scope.wallets, 2, "exchanger + OTC, trader excluded");
  const w = Object.fromEntries(l.windows.map((x) => [x.hours, x]));
  assert.deepEqual([w[1].inflow, w[1].outflow], [5_000, 0]);
  assert.deepEqual([w[4].inflow, w[4].outflow], [8_000, 1_000]);
  assert.deepEqual([w[24].inflow, w[24].outflow], [8_000, 3_000]);
  assert.ok(w[4].intensity !== null && w[4].intensity > 1, "above the 3-day baseline");
  assert.equal(l.pressure.side, "sell");
  assert.equal(l.pressure.strength, "high"); // (8000-1000)/9000 = 0.78
  assert.ok(l.pressure.confident);
  // скорость: весь оборот рынка за 24 ч (включая внутренний) / баланс 150 000
  assert.ok(Math.abs(l.velocity.h24! - (5_000 + 3_000 + 1_000 + 7_000 + 2_000 + 1_000 * 0) / 150_000) < 0.02);
  assert.ok(l.series.length >= 48 && l.series.length <= 50, `48h hourly series, got ${l.series.length}`);
  // фон: переводы с 26-го по 48-й час назад включительно = 23 шт.
  assert.equal(Math.round(l.series.reduce((s, b) => s + b.inflow, 0)), 8_000 + 23_000, "inflow in series = last 48h");
  assert.equal(l.movers[0].address, EX);
});

test("liquidity: no baseline while a wallet's history is incomplete", async () => {
  await prisma.wallet.update({ where: { address: OTC }, data: { historyFrom: new Date(Date.now() - 3_600_000) } });
  const l = await getLiquidity({ window: 4 });
  assert.ok(l.windows.every((w) => w.intensity === null), "no fake «×400 000 к норме»");
  assert.equal(l.velocity.avgDaily7d, null);
  await prisma.wallet.update({ where: { address: OTC }, data: { historyFrom: new Date(Date.now() - 10 * 86_400_000) } });
});

test("liquidity: 'all' scope includes trader, empty book is safe", async () => {
  const all = await getLiquidity({ scope: "all", window: 1 });
  assert.equal(all.scope.wallets, 3);
  assert.equal(all.windows.find((x) => x.hours === 1)!.outflow, 9_999);
});

test("alerts: first run arms cursors without spamming history", async () => {
  const sent: string[] = [];
  const r = await runAlerts({ send: async (h) => void sent.push(h) });
  assert.equal(sent.filter((m) => m.includes("🐋")).length, 0);
  assert.ok(r.events <= 1, "only a possible volume spike");
});

test("alerts: whale, new counterparty, no duplicates, backfill ignored", async () => {
  await saveTransfers([
    t(C1, EX, 25_000, 1), // кит
    t(NEWBIE, OTC, 6_000, 2), // новый адрес
    t(C2, EX, 50_000, 60 * 30), // старый перевод из бэкфилла — без уведомления
  ]);
  const sent: string[] = [];
  const r = await runAlerts({ send: async (h) => void sent.push(h) });
  const whale = sent.find((m) => m.includes("🐋"));
  assert.ok(whale, "whale alert sent");
  assert.match(whale!, /25 000 USDT/);
  assert.match(whale!, /http:\/\/desk\.local:3000\/wallets\/TR7N/);
  assert.match(whale!, /tronscan\.org\/#\/transaction\//);
  const fresh = sent.find((m) => m.includes("Новый адрес"));
  assert.ok(fresh && fresh.includes("TBuGAa"), "new counterparty alert");
  assert.ok(!sent.some((m) => m.includes("50 000")), "backfilled transfer ignored");
  assert.ok(r.sent >= 2);

  const again: string[] = [];
  await runAlerts({ send: async (h) => void again.push(h) });
  assert.ok(!again.some((m) => m.includes("🐋") || m.includes("Новый адрес")), "no duplicates on rerun");
});

test("alerts: failed delivery is recorded", async () => {
  await saveTransfers([t(C2, EX, 30_000, 1)]);
  const r = await runAlerts({ send: async () => Promise.reject(new Error("Чат не найден")) });
  assert.ok(r.failed >= 1);
  const ev = await prisma.alertEvent.findFirst({ where: { status: "FAILED" } });
  assert.equal(ev?.error, "Чат не найден");
});

test("alerts: without Telegram configured events are logged as skipped", async () => {
  await saveTransfers([t(C1, OTC, 40_000, 1)]);
  const r = await runAlerts();
  assert.ok(r.skipped >= 1);
});

test("alerts: volume spike fires once per cooldown", async () => {
  await prisma.alertEvent.deleteMany({ where: { rule: { type: "VOLUME_SPIKE" } } });
  await saveTransfers([t(C1, EX, 60_000, 5)]);
  const a: string[] = [];
  await runAlerts({ send: async (h) => void a.push(h) });
  assert.ok(a.some((m) => m.includes("Всплеск объёма")), "spike detected");
  const b: string[] = [];
  await runAlerts({ send: async (h) => void b.push(h) });
  assert.ok(!b.some((m) => m.includes("Всплеск объёма")), "cooldown holds");
});

test("pattern scan: stores, dedupes on rescan, apply tags wallets, alert fires", async () => {
  const { transfers } = makeScenario();
  await saveTransfers(
    transfers.map((x) => ({ txHash: x.txHash.replace(/^0+/, "f").padStart(64, "f"), from: x.from, to: x.to, amount: String(x.amount), blockTimestamp: x.ts })),
  );
  const first = await scanAndStore(30);
  assert.ok(first.found >= 3 && first.created === first.found, JSON.stringify(first));
  const second = await scanAndStore(30);
  assert.equal(second.created, 0, "rescan updates instead of duplicating");

  const fanOut = await prisma.patternFinding.findFirstOrThrow({ where: { type: "FAN_OUT" }, orderBy: { score: "desc" } });
  await applyFinding(fanOut.id);
  const tagged = await prisma.wallet.findUniqueOrThrow({
    where: { address: fanOut.address },
    include: { labels: { include: { label: true } } },
  });
  assert.ok(tagged.labels.some((l) => l.label.name === "рассылка" && l.label.source === "AUTO"));

  const sent: string[] = [];
  await runAlerts({ send: async (h) => void sent.push(h) });
  assert.ok(sent.some((m) => m.includes("🔍")), "pattern alert (single or digest)");
});
