/**
 * Бессрочные фьючерсы USDT на Binance и Bybit: цена, открытый интерес, ставка финансирования.
 * Публичные REST-методы без ключа. Разбор ответов — чистые функции (tests/market.test.ts).
 */

export const MARKET_ASSETS = ["BTC", "ETH", "XRP", "SOL"] as const;
export type MarketAsset = (typeof MARKET_ASSETS)[number];

export const EXCHANGES = ["binance", "bybit"] as const;
export type Exchange = (typeof EXCHANGES)[number];
export const EXCHANGE_LABEL: Record<Exchange, string> = { binance: "Binance", bybit: "Bybit" };

export interface MarketTick {
  exchange: Exchange;
  asset: MarketAsset;
  price: number;
  oiUsd: number;
  /** ставка финансирования, приведённая к 8 ч (доля: 0.0001 = 0,01 %) */
  funding8h: number;
  volume24hUsd: number;
  change24hPct: number;
}

export const symbolOf = (asset: MarketAsset) => `${asset}USDT`;
export const assetOfSymbol = (symbol: string) => MARKET_ASSETS.find((a) => symbolOf(a) === symbol) ?? null;

const TIMEOUT_MS = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function checked(tick: MarketTick): MarketTick {
  const bad = (["price", "oiUsd", "funding8h", "volume24hUsd", "change24hPct"] as const).filter((k) => !Number.isFinite(tick[k]));
  if (bad.length || tick.price <= 0) throw new Error(`некорректный ответ ${EXCHANGE_LABEL[tick.exchange]}: ${bad.join(", ") || "price"}`);
  return tick;
}

// --- Binance -----------------------------------------------------------------

interface BinancePremium {
  markPrice: string;
  lastFundingRate: string;
}
interface BinanceOpenInterest {
  openInterest: string;
}
interface BinanceTicker {
  quoteVolume: string;
  priceChangePercent: string;
}

/** Открытый интерес Binance — в монетах; в доллары — по цене маркировки. Ставка у этих монет — раз в 8 ч. */
export function parseBinance(asset: MarketAsset, p: BinancePremium, oi: BinanceOpenInterest, t: BinanceTicker): MarketTick {
  const price = Number(p.markPrice);
  return checked({
    exchange: "binance",
    asset,
    price,
    oiUsd: Number(oi.openInterest) * price,
    funding8h: Number(p.lastFundingRate),
    volume24hUsd: Number(t.quoteVolume),
    change24hPct: Number(t.priceChangePercent),
  });
}

export async function fetchBinance(asset: MarketAsset): Promise<MarketTick> {
  const base = "https://fapi.binance.com/fapi/v1";
  const s = symbolOf(asset);
  const [p, oi, t] = await Promise.all([
    getJson<BinancePremium>(`${base}/premiumIndex?symbol=${s}`),
    getJson<BinanceOpenInterest>(`${base}/openInterest?symbol=${s}`),
    getJson<BinanceTicker>(`${base}/ticker/24hr?symbol=${s}`),
  ]);
  return parseBinance(asset, p, oi, t);
}

// --- Bybit -------------------------------------------------------------------

interface BybitTickers {
  retCode: number;
  retMsg: string;
  result?: {
    list?: {
      markPrice: string;
      openInterestValue: string;
      fundingRate: string;
      fundingIntervalHour?: string;
      turnover24h: string;
      price24hPcnt: string;
    }[];
  };
}

export function parseBybit(asset: MarketAsset, r: BybitTickers): MarketTick {
  const x = r.result?.list?.[0];
  if (r.retCode !== 0 || !x) throw new Error(`Bybit: ${r.retMsg || "пустой ответ"}`);
  const hours = Number(x.fundingIntervalHour) || 8;
  return checked({
    exchange: "bybit",
    asset,
    price: Number(x.markPrice),
    oiUsd: Number(x.openInterestValue),
    funding8h: (Number(x.fundingRate) * 8) / hours,
    volume24hUsd: Number(x.turnover24h),
    change24hPct: Number(x.price24hPcnt) * 100,
  });
}

export async function fetchBybit(asset: MarketAsset): Promise<MarketTick> {
  return parseBybit(asset, await getJson<BybitTickers>(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbolOf(asset)}`));
}

export const FETCHERS: Record<Exchange, (asset: MarketAsset) => Promise<MarketTick>> = { binance: fetchBinance, bybit: fetchBybit };
