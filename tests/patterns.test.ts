import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFanIn, detectFanOut, detectLoops, scanPatterns } from "../src/lib/patterns/detect";
import { makeScenario } from "./fixtures/scenario";

const { transfers, expected } = makeScenario();

test("fan-out: burst payout is found, slow distribution is not", () => {
  const found = detectFanOut(transfers);
  const payout = found.find((f) => f.address === expected.payer);
  assert.ok(payout, "payout detected");
  assert.equal(payout!.metrics.recipients, 15);
  assert.ok((payout!.metrics.cv as number) < 0.05, "amounts are near-identical");
  assert.ok(payout!.score >= 0.8);
  assert.ok(!found.some((f) => f.address === expected.slow), "weeks-long payouts are not a burst");
});

test("fan-out: exchange withdrawals with wildly different amounts are not a payout", () => {
  const now = Date.now();
  const amounts = [12, 9_800, 150, 3_000, 45, 20_000, 700, 5, 1_200, 8_000, 60, 15_000];
  const hot = amounts.map((amount, i) => ({ txHash: String(i), from: "THot", to: `TClient${i}`, amount, ts: now - i * 60_000 }));
  assert.equal(detectFanOut(hot).length, 0);
});

test("fan-in: pool of small transfers with sweeps", () => {
  const found = detectFanIn(transfers);
  const pool = found.find((f) => f.address === expected.pool);
  assert.ok(pool);
  assert.equal(pool!.metrics.senders, 40);
  assert.equal(pool!.metrics.transfers, 45);
  assert.match(pool!.summary, /крупными переводами/);
});

test("loop: time-respecting cycle with retained amount", () => {
  const loops = detectLoops(transfers);
  const real = loops.find((f) => expected.cycle.every((a) => f.addresses.includes(a)));
  assert.ok(real, "OTC -> X -> Y -> OTC detected");
  const hops = real!.metrics.hops as { ts: number }[];
  assert.ok(hops.every((h, i) => i === 0 || h.ts >= hops[i - 1].ts), "hops are in time order");
  for (const fake of expected.fakeLoops) {
    assert.ok(!loops.some((f) => fake.every((a) => f.addresses.includes(a))), "fake loop rejected");
  }
});

test("loop key is stable regardless of rotation", () => {
  const t = (from: string, to: string, ts: number) => ({ txHash: `${from}${to}`, from, to, amount: 100, ts });
  const k1 = detectLoops([t("A", "B", 1), t("B", "C", 2), t("C", "A", 3)])[0].key;
  const k2 = detectLoops([t("B", "C", 1), t("C", "A", 2), t("A", "B", 3)])[0].key;
  assert.equal(k1, k2);
});

test("scanPatterns returns findings sorted by score", () => {
  const all = scanPatterns(transfers);
  assert.ok(all.length >= 3);
  assert.ok(all.every((f, i) => i === 0 || f.score <= all[i - 1].score));
});
