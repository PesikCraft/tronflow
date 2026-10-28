/**
 * Снимок рынка деривативов раз в MARKET_POLL_MIN: по каждой монете и бирже — цена,
 * открытый интерес, ставка финансирования и ликвидации, накопленные потоком с прошлого снимка.
 * Если биржа не ответила, её ликвидации остаются в памяти до следующего удачного снимка.
 */
import { prisma } from "../db";
import { setState } from "../ingest";
import { EXCHANGE_LABEL, EXCHANGES, FETCHERS, MARKET_ASSETS, type Exchange, type MarketAsset } from "./exchanges";
import type { LiqTotals, StreamStatus } from "./liquidations";

export interface LiquidationSource {
  take(exchange: Exchange, asset: MarketAsset): LiqTotals;
  status(): Record<Exchange, StreamStatus>;
}

const errorText = (err: unknown) =>
  err instanceof Error && err.name === "TimeoutError" ? "нет ответа за 10 с" : (err instanceof Error ? err.message : String(err)).slice(0, 200);

export async function pollMarket(liq: LiquidationSource, opts: { now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const jobs = MARKET_ASSETS.flatMap((asset) => EXCHANGES.map((exchange) => ({ asset, exchange })));
  const results = await Promise.allSettled(jobs.map((j) => FETCHERS[j.exchange](j.asset)));

  const takenAt = new Date(now);
  const errors: Partial<Record<Exchange, string>> = {};
  const rows = results.flatMap((r, i) => {
    const { asset, exchange } = jobs[i];
    if (r.status === "rejected") {
      errors[exchange] ??= errorText(r.reason);
      return [];
    }
    const l = liq.take(exchange, asset);
    return [{ ...r.value, takenAt, liqLongUsd: l.longUsd, liqShortUsd: l.shortUsd }];
  });
  if (rows.length) await prisma.marketSnapshot.createMany({ data: rows });

  const failed = Object.keys(errors).map((e) => EXCHANGE_LABEL[e as Exchange]);
  await setState("market_status", JSON.stringify({ at: now, saved: rows.length, errors, streams: liq.status() }));
  return { saved: rows.length, failed };
}
