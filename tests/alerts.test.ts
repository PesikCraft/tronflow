import { test } from "node:test";
import assert from "node:assert/strict";
import { digestMessage, whaleMessage, spikeMessage } from "../src/lib/alerts/messages";
import { describeRule, parseParams } from "../src/lib/alerts/rules";
import { computePressure } from "../src/lib/liquidity";

const tx = { txHash: "ab".repeat(32), from: "TFrom000000000000000000000000000001", to: "TTo00000000000000000000000000000002", amount: 25_000.4, ts: Date.UTC(2026, 8, 24, 15, 46) };

test("whale message: amount, Yerevan time, links, HTML-escaped labels", () => {
  const labels = new Map([[tx.from, "Desk <A> & Co"]]);
  const m = whaleMessage(tx, labels, "Кит > 20k", { dashboardUrl: "http://desk:3000" });
  assert.match(m, /25 000 USDT/);
  assert.match(m, /24\.09, 19:46/, "UTC 15:46 = 19:46 in Yerevan");
  assert.match(m, /Desk &lt;A&gt; &amp; Co/);
  assert.match(m, /Кит &gt; 20k/);
  assert.match(m, /href="http:\/\/desk:3000\/wallets\/TFrom/);
  assert.match(m, /href="https:\/\/tronscan\.org\/#\/transaction\/abab/);
  assert.ok(!m.includes("<A>"));
});

test("without dashboard URL links go to Tronscan", () => {
  const m = whaleMessage(tx, new Map(), "r", {});
  assert.match(m, /tronscan\.org\/#\/address\/TFrom/);
});

test("spike message and digest", () => {
  const s = spikeMessage({ current: 90_000, baseline: 30_000, windowMin: 30, count: 12, topWallets: [{ label: "Ex", volume: 50_000 }] }, "Всплеск", {});
  assert.match(s, /×3\.0/);
  const d = digestMessage("Кит", "🐋", Array.from({ length: 14 }, (_, i) => `line ${i}`), 14);
  assert.match(d, /14 событий/);
  assert.match(d, /…и ещё 4/);
});

test("rule params validation and description", () => {
  assert.throws(() => parseParams("WHALE", { minAmount: -5 }));
  assert.match(describeRule("WHALE", { minAmount: 20000 }), /^перевод от 20\s000 USDT$/); // разделитель — неразрывный пробел
  assert.match(describeRule("VOLUME_SPIKE", { windowMin: 30, spikePct: 100, minVolume: 10000, baselineDays: 7 }), /30 мин.*100 %/);
});

test("pressure thresholds and direction", () => {
  const p = (inflow: number, outflow: number, intensity: number | null = 1) => computePressure({ inflow, outflow, intensity, hours: 4 });
  assert.equal(p(10_000, 9_000).side, "balanced");
  assert.deepEqual([p(13_000, 7_000).side, p(13_000, 7_000).strength], ["sell", "moderate"]); // 0.3
  assert.deepEqual([p(1_000, 9_000).side, p(1_000, 9_000).strength], ["buy", "high"]); // -0.8
  assert.equal(p(5_500, 4_500).strength, null);
  assert.equal(p(12_000, 8_000).strength, "weak"); // 0.2
  assert.ok(!p(300, 0).confident, "too little volume");
  assert.ok(!p(10_000, 0, 0.1).confident, "far below normal activity");
  assert.match(p(1_000, 9_000).headline, /покупок/);
});
