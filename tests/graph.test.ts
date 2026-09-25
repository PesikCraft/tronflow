import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlowGraph } from "../src/lib/graph/build";
import { makeScenario } from "./fixtures/scenario";

const { transfers, wallets, expected } = makeScenario();
const full = buildFlowGraph(transfers, wallets, { depth: Infinity });
const roles = (id: string) => full.nodes.find((n) => n.id === id)?.roles ?? [];

test("detects pyramid apex, splitter, transit", () => {
  assert.ok(roles(expected.apex).includes("apex"));
  assert.ok(roles(expected.splitter).includes("splitter"));
  assert.ok(roles(expected.transit).includes("transit"));
  assert.ok(!roles(expected.transit).includes("splitter"));
});

test("graph marks the real loop and behavioural roles", () => {
  assert.ok(full.cycles.some((c) => c.length === 3 && expected.cycle.every((a) => c.includes(a))));
  assert.equal(full.edges.filter((e) => e.inCycle).length, 3, "only the time-respecting loop is flagged");
  assert.ok(roles(expected.cycle[1]).includes("loop"));
  assert.ok(roles(expected.payer).includes("fan_out"));
  assert.ok(roles(expected.pool).includes("fan_in"));
});

test("depth filter", () => {
  const d1 = buildFlowGraph(transfers, wallets, { depth: 1 });
  const d2 = buildFlowGraph(transfers, wallets, { depth: 2 });
  assert.ok(d1.nodes.every((n) => n.depth >= 0 && n.depth <= 1));
  assert.ok(d2.nodes.every((n) => n.depth <= 2));
  assert.ok(d1.nodes.length < d2.nodes.length && d2.nodes.length < full.nodes.length);
  assert.ok(full.nodes.some((n) => n.depth >= 3), "distances are computed even without a depth limit");
});

test("custom seeds", () => {
  const g = buildFlowGraph(transfers, wallets, { seeds: [expected.apex], depth: 1 });
  assert.ok(g.nodes.find((n) => n.id === expected.apex)?.isSeed);
  assert.ok(g.nodes.every((n) => n.depth <= 1));
});

test("amount/date filters and edge cap", () => {
  const big = buildFlowGraph(transfers, wallets, { depth: Infinity, minAmount: 10_000 });
  assert.ok(big.edges.length > 0 && big.edges.every((e) => e.total >= 10_000));
  const cutoff = Date.now() - 24 * 3_600_000;
  const recent = buildFlowGraph(transfers, wallets, { depth: Infinity, fromTs: cutoff });
  assert.ok(recent.edges.every((e) => e.firstTs >= cutoff));
  const capped = buildFlowGraph(transfers, wallets, { depth: Infinity, maxEdges: 10 });
  assert.equal(capped.edges.length, 10);
  assert.ok(capped.truncated);
});

test("aggregation: parallel transfers merge into one edge", () => {
  const a = "TA", b = "TB";
  const g = buildFlowGraph(
    [
      { txHash: "1", from: a, to: b, amount: 100, ts: 1 },
      { txHash: "2", from: a, to: b, amount: 50, ts: 5 },
      { txHash: "3", from: b, to: a, amount: 10, ts: 3 },
    ],
    [],
    { depth: Infinity },
  );
  const ab = g.edges.find((e) => e.id === `${a}->${b}`)!;
  assert.deepEqual([ab.total, ab.count, ab.firstTs, ab.lastTs], [150, 2, 1, 5]);
  assert.equal(g.edges.length, 2);
});
