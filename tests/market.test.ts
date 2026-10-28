import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBinance, parseBybit } from "../src/lib/market/exchanges";
import { parseBinanceLiquidation, parseBybitLiquidations } from "../src/lib/market/liquidations";
import { readPositioning, summarizeAsset, type SnapshotRow } from "../src/lib/market/reading";
import { describeRule } from "../src/lib/alerts/rules";

// Ответы бирж — как пришли от API 29.10.2026
const premium = { markPrice: "81245.60000000", lastFundingRate: "0.00010000" };
const bybitTicker = {
  retCode: 0,
  retMsg: "OK",
  result: {
    list: [
      {
        markPrice: "81226.88",
        openInterestValue: "5093232251.15",
        fundingRate: "0.0001",
        fundingIntervalHour: "8",
        turnover24h: "4122679851.8365",
        price24hPcnt: "0.006677",
      },
    ],
  },
};

test("Binance: open interest in coins -> USD by mark price", () => {
  const t = parseBinance("BTC", premium, { openInterest: "95640.948" }, { quoteVolume: "10425084265.69", priceChangePercent: "0.711" });
  assert.equal(t.price, 81245.6);
  assert.ok(Math.abs(t.oiUsd - 95640.948 * 81245.6) < 1);
  assert.equal(t.funding8h, 0.0001);
  assert.equal(t.change24hPct, 0.711);
});

test("Bybit: funding normalised to 8h, errors are explicit", () => {
  const t = parseBybit("BTC", bybitTicker);
  assert.equal(t.oiUsd, 5093232251.15);
  assert.ok(Math.abs(t.change24hPct - 0.6677) < 1e-9);
  const fourHour = structuredClone(bybitTicker);
  fourHour.result.list[0].fundingIntervalHour = "4";
  assert.equal(parseBybit("BTC", fourHour).funding8h, 0.0002);
  assert.throws(() => parseBybit("BTC", { retCode: 10001, retMsg: "params error" }), /params error/);
  assert.throws(() => parseBinance("BTC", { markPrice: "", lastFundingRate: "0" }, { openInterest: "1" }, { quoteVolume: "1", priceChangePercent: "0" }));
});

test("liquidations: sides and amounts, other symbols ignored", () => {
  const binance = (s: string, side: string) => ({ e: "forceOrder", o: { s, S: side, z: "2", ap: "80000", p: "79000" } });
  assert.deepEqual(parseBinanceLiquidation(binance("BTCUSDT", "SELL")), [{ exchange: "binance", asset: "BTC", side: "long", usd: 160_000 }]);
  assert.equal(parseBinanceLiquidation(binance("BTCUSDT", "BUY"))[0].side, "short");
  assert.deepEqual(parseBinanceLiquidation(binance("1000PEPEUSDT", "SELL")), []);
  assert.deepEqual(parseBinanceLiquidation({ success: true }), []);

  const bybit = { topic: "allLiquidation.ETHUSDT", data: [{ s: "ETHUSDT", S: "Buy", v: "10", p: "3000" }, { s: "ETHUSDT", S: "Sell", v: "1", p: "3000" }] };
  assert.deepEqual(
    parseBybitLiquidations(bybit).map((e) => [e.side, e.usd]),
    [
      ["long", 30_000],
      ["short", 3_000],
    ],
  );
  assert.deepEqual(parseBybitLiquidations({ op: "pong" }), []);
});

test("reading: price and open interest together", () => {
  const base = { funding8h: 0.0001, oiUsd: 1e10, liq1h: { long: 0, short: 0 } };
  assert.match(readPositioning({ ...base, priceChange1h: 1, oiChange1h: 2 }).headline, /^Набирают лонги/);
  assert.match(readPositioning({ ...base, priceChange1h: 1, oiChange1h: -2 }).headline, /^Закрываются шорты/);
  assert.match(readPositioning({ ...base, priceChange1h: -1, oiChange1h: 2 }).headline, /^Набирают шорты/);
  assert.match(readPositioning({ ...base, priceChange1h: -1, oiChange1h: -2 }).headline, /^Выходят лонги/);
  assert.match(readPositioning({ ...base, priceChange1h: 0.1, oiChange1h: 0.2 }).headline, /^Спокойно/);
  assert.match(readPositioning({ ...base, priceChange1h: null, oiChange1h: null }).headline, /Мало данных/);
});

test("reading: hot funding and a liquidation wave are noted", () => {
  const r = readPositioning({ priceChange1h: -2, oiChange1h: -3, funding8h: 0.0006, oiUsd: 1e10, liq1h: { long: 30e6, short: 2e6 } });
  assert.equal(r.tone, "down");
  assert.ok(r.notes.some((n) => n.includes("перегрет")));
  assert.ok(r.notes.some((n) => n.includes("лонгов на $30.0 млн")));
  // мелкие ликвидации относительно интереса — не повод
  assert.equal(readPositioning({ priceChange1h: 0, oiChange1h: 0, funding8h: 0.0001, oiUsd: 1e10, liq1h: { long: 2e6, short: 0 } }).notes.length, 0);
});

test("summary: a failed exchange does not look like an open interest crash", () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const row = (exchange: string, minAgo: number, oiUsd: number, price: number, liqLongUsd = 0): SnapshotRow => ({
    exchange,
    takenAt: new Date(now - minAgo * 60_000),
    price,
    oiUsd,
    funding8h: 0.0001,
    change24hPct: 1,
    liqLongUsd,
    liqShortUsd: 0,
  });
  const rows = [
    row("binance", 60, 10e9, 80_000),
    row("bybit", 60, 5e9, 80_000),
    row("binance", 30, 10.1e9, 80_400), // Bybit не ответил — точку пропускаем
    row("binance", 0, 10.2e9, 81_000, 3e6),
    row("bybit", 0, 5.1e9, 81_000, 1e6),
  ];
  const m = summarizeAsset("BTC", rows, now)!;
  assert.equal(m.oiUsd, 15.3e9);
  assert.ok(Math.abs(m.oiChange1h! - 2) < 1e-9, `oi change ${m.oiChange1h}`);
  assert.ok(Math.abs(m.priceChange1h! - 1.25) < 1e-9);
  assert.equal(m.oiChange24h, null);
  assert.deepEqual(m.liq1h, { long: 4e6, short: 0 });
  assert.equal(m.oiSeries.length, 2);
  assert.match(m.reading.headline, /^Набирают лонги/);
  assert.equal(summarizeAsset("BTC", [], now), null);
});

test("derivatives rule description", () => {
  assert.match(describeRule("DERIVATIVES", { minLiqUsd: 20_000_000, minOiChangePct: 3, assets: ["BTC"] }), /ликвидации за час от \$20\s000\s000 или открытый интерес за час ±3 %; BTC/);
});
