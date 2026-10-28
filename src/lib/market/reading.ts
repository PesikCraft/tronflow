/**
 * Сводка деривативов по монете из снимков и «чтение» позиций простыми правилами:
 * цена и открытый интерес за час, ставка финансирования, ликвидации.
 * Это эвристика для аналитика, а не прогноз. Чистые функции (tests/market.test.ts).
 */

export interface SnapshotRow {
  exchange: string;
  takenAt: Date;
  price: number;
  oiUsd: number;
  funding8h: number;
  change24hPct: number;
  liqLongUsd: number;
  liqShortUsd: number;
}

export interface Reading {
  tone: "up" | "down" | "calm";
  headline: string;
  notes: string[];
}

export interface AssetMarket {
  asset: string;
  updatedAt: Date;
  exchanges: string[];
  price: number;
  change24hPct: number;
  priceChange1h: number | null;
  oiUsd: number;
  oiChange1h: number | null;
  oiChange24h: number | null;
  /** средняя по биржам с весом открытого интереса */
  funding8h: number;
  liq1h: { long: number; short: number };
  liq24h: { long: number; short: number };
  /** суммарный открытый интерес за сутки — для спарклайна */
  oiSeries: { ts: number; value: number }[];
  reading: Reading;
}

const HOUR = 3_600_000;
/** Пороги «заметного» движения за час */
const MOVE_PRICE_PCT = 0.5;
const MOVE_OI_PCT = 1;
const HOT_FUNDING = 0.0005; // 0,05 % за 8 ч — впятеро выше обычных 0,01 %
const NEGATIVE_FUNDING = -0.0001;
/** Ликвидации за час заметны от 0,1 % открытого интереса и не меньше $1 млн */
const LIQ_SHARE = 0.001;
const LIQ_MIN_USD = 1_000_000;

const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} %`;
const fmtUsd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)} млрд` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)} млн` : `$${Math.round(v / 1e3)} тыс.`;

export function readPositioning(m: {
  priceChange1h: number | null;
  oiChange1h: number | null;
  funding8h: number;
  oiUsd: number;
  liq1h: { long: number; short: number };
}): Reading {
  const notes: string[] = [];
  if (m.funding8h >= HOT_FUNDING) {
    notes.push(`Ставка финансирования высокая, ${(m.funding8h * 100).toFixed(3)} % за 8 ч: лонги переплачивают, рынок перегрет.`);
  } else if (m.funding8h <= NEGATIVE_FUNDING) {
    notes.push(`Ставка отрицательная, ${(m.funding8h * 100).toFixed(3)} % за 8 ч: шорты платят лонгам, перекос в продажи.`);
  }
  const liq = m.liq1h.long + m.liq1h.short;
  if (liq >= LIQ_MIN_USD && liq >= m.oiUsd * LIQ_SHARE) {
    notes.push(
      m.liq1h.long >= m.liq1h.short
        ? `За час ликвидировано лонгов на ${fmtUsd(m.liq1h.long)}: вынужденные продажи.`
        : `За час ликвидировано шортов на ${fmtUsd(m.liq1h.short)}: вынужденные покупки.`,
    );
  }

  const p = m.priceChange1h;
  const o = m.oiChange1h;
  if (p === null || o === null) return { tone: "calm", headline: "Мало данных: нужен хотя бы час наблюдений", notes };
  const pUp = p >= MOVE_PRICE_PCT;
  const pDown = p <= -MOVE_PRICE_PCT;
  const oUp = o >= MOVE_OI_PCT;
  const oDown = o <= -MOVE_OI_PCT;
  const moves = `цена ${fmtPct(p)}, интерес ${fmtPct(o)} за час`;
  if (pUp && oUp) return { tone: "up", headline: `Набирают лонги: ${moves}`, notes };
  if (pUp && oDown) return { tone: "up", headline: `Закрываются шорты: ${moves}`, notes };
  if (pDown && oUp) return { tone: "down", headline: `Набирают шорты: ${moves}`, notes };
  if (pDown && oDown) return { tone: "down", headline: `Выходят лонги: ${moves}`, notes };
  if (oUp) return { tone: "calm", headline: `Копятся позиции при стоящей цене: ${moves}`, notes };
  if (oDown) return { tone: "calm", headline: `Позиции закрываются, цена стоит: ${moves}`, notes };
  return { tone: "calm", headline: `Спокойно: ${moves}`, notes };
}

/**
 * Снимки одной монеты (все биржи, за сутки с запасом) -> сводка.
 * Изменения считаются только по моментам, где ответили те же биржи, что и сейчас:
 * иначе сбой одной биржи выглядел бы обвалом открытого интереса.
 */
export function summarizeAsset(asset: string, rows: SnapshotRow[], now: number): AssetMarket | null {
  if (!rows.length) return null;
  const byTime = new Map<number, SnapshotRow[]>();
  for (const r of rows) {
    const t = r.takenAt.getTime();
    (byTime.get(t) ?? byTime.set(t, []).get(t)!).push(r);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const latestT = times[times.length - 1];
  const latest = byTime.get(latestT)!;
  const set = latest.map((r) => r.exchange).sort().join(",");
  const lead = latest.find((r) => r.exchange === "binance") ?? latest[0];

  // Ряд: суммарный интерес и цена ведущей биржи — только моменты с тем же набором бирж
  const series = times
    .filter((t) => now - t <= 24 * HOUR)
    .map((t) => ({ t, rows: byTime.get(t)! }))
    .filter(({ rows: rs }) => rs.map((r) => r.exchange).sort().join(",") === set)
    .map(({ t, rows: rs }) => ({
      ts: t,
      oi: rs.reduce((s, r) => s + r.oiUsd, 0),
      price: (rs.find((r) => r.exchange === lead.exchange) ?? rs[0]).price,
    }));
  const current = series[series.length - 1];
  /** Точка ряда не позже чем `ago` назад (самая свежая из таких); null — истории не хватает. */
  const at = (ago: number) => {
    const cut = latestT - ago;
    const older = series.filter((s) => s.ts <= cut);
    // допускаем, что первая точка чуть моложе окна (снимки раз в несколько минут)
    return older.length ? older[older.length - 1] : series[0] && series[0].ts <= cut + 10 * 60_000 ? series[0] : null;
  };
  const h1 = at(HOUR);
  const h24 = at(24 * HOUR);

  const oiUsd = latest.reduce((s, r) => s + r.oiUsd, 0);
  const funding8h = oiUsd > 0 ? latest.reduce((s, r) => s + r.funding8h * r.oiUsd, 0) / oiUsd : lead.funding8h;
  const liq = (since: number) => {
    const rs = rows.filter((r) => r.takenAt.getTime() > now - since);
    return { long: rs.reduce((s, r) => s + r.liqLongUsd, 0), short: rs.reduce((s, r) => s + r.liqShortUsd, 0) };
  };

  const m = {
    asset,
    updatedAt: new Date(latestT),
    exchanges: latest.map((r) => r.exchange),
    price: lead.price,
    change24hPct: lead.change24hPct,
    priceChange1h: h1 && current ? pct(current.price, h1.price) : null,
    oiUsd,
    oiChange1h: h1 && current ? pct(current.oi, h1.oi) : null,
    oiChange24h: h24 && current ? pct(current.oi, h24.oi) : null,
    funding8h,
    liq1h: liq(HOUR),
    liq24h: liq(24 * HOUR),
    oiSeries: series.map((s) => ({ ts: s.ts, value: s.oi })),
  };
  return { ...m, reading: readPositioning(m) };
}
