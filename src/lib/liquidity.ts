/**
 * Ликвидность и давление на курс.
 *
 * «Рынок» — кошельки обменников и OTC из адресной книги (если их нет — вся книга).
 * Внешний приток USDT на них = клиенты продают USDT → давление продаж (курс USDT/AMD вниз).
 * Внешний отток = клиенты покупают USDT → давление покупок (курс вверх).
 * Переводы между кошельками рынка — внутренние, в давлении не участвуют.
 */
import { prisma } from "./db";
import { env } from "./env";

export const FLOW_WINDOWS = [1, 4, 24] as const;
export type FlowWindowHours = (typeof FLOW_WINDOWS)[number];
export const SERIES_RANGES = { "48h": { hours: 48, bucket: "1 hour" }, "7d": { hours: 168, bucket: "4 hours" }, "30d": { hours: 720, bucket: "1 day" } } as const;
export type SeriesRange = keyof typeof SERIES_RANGES;

export interface FlowWindow {
  hours: number;
  inflow: number;
  outflow: number;
  net: number; // inflow − outflow
  gross: number;
  /** (in − out) / (in + out): +1 — только приток, −1 — только отток */
  imbalance: number;
  /** оборот окна относительно средней нормы такого же окна за прошлые 7 дней */
  intensity: number | null;
}

export type PressureSide = "sell" | "buy" | "balanced";
export type PressureStrength = "weak" | "moderate" | "high";

export interface Pressure {
  side: PressureSide;
  strength: PressureStrength | null;
  score: number; // = imbalance, −1..1
  confident: boolean;
  headline: string;
  explanation: string;
}

const fmt = (v: number) => Math.round(v).toLocaleString("ru-RU");

/** Чистая функция: окно потоков -> индикатор давления. */
export function computePressure(w: Pick<FlowWindow, "inflow" | "outflow" | "intensity" | "hours">, minGross = 1_000): Pressure {
  const gross = w.inflow + w.outflow;
  const score = gross > 0 ? (w.inflow - w.outflow) / gross : 0;
  const abs = Math.abs(score);
  const confident = gross >= minGross && (w.intensity === null || w.intensity >= 0.3);
  const period = w.hours === 1 ? "последний час" : `последние ${w.hours} ч`;

  if (abs < 0.15) {
    return {
      side: "balanced",
      strength: null,
      score,
      confident,
      headline: "Рынок в балансе",
      explanation: `За ${period} приток ${fmt(w.inflow)} и отток ${fmt(w.outflow)} USDT почти равны.`,
    };
  }
  const strength: PressureStrength = abs >= 0.5 ? "high" : abs >= 0.3 ? "moderate" : "weak";
  const word = { weak: "слабое", moderate: "умеренное", high: "сильное" }[strength];
  const side: PressureSide = score > 0 ? "sell" : "buy";
  return {
    side,
    strength,
    score,
    confident,
    headline: side === "sell" ? `Давление продаж USDT: ${word}` : `Давление покупок USDT: ${word}`,
    explanation:
      side === "sell"
        ? `За ${period} на обменники пришло на ${fmt(w.inflow - w.outflow)} USDT больше, чем ушло: клиенты сдают USDT, у обменников копится предложение.`
        : `За ${period} с обменников ушло на ${fmt(w.outflow - w.inflow)} USDT больше, чем пришло: клиенты покупают USDT, предложение у обменников сокращается.`,
  };
}

/** Адреса «рынка»: обменники и OTC; если их нет — вся адресная книга. */
export async function marketScope(scope: "market" | "all" = "market") {
  const wallets = await prisma.wallet.findMany({
    where: { isWatched: true },
    select: { address: true, category: true, usdtBalance: true, label: true, historyFrom: true },
  });
  const market = wallets.filter((w) => w.category === "EXCHANGE" || w.category === "OTC");
  const chosen = scope === "market" && market.length ? market : wallets;
  return {
    kind: scope === "market" && market.length ? ("market" as const) : ("all" as const),
    wallets: chosen,
    addresses: chosen.map((w) => w.address),
    totalBalance: chosen.reduce((s, w) => s + (w.usdtBalance ? Number(w.usdtBalance) : 0), 0),
    coverageStart: coverageStart(chosen),
  };
}

/**
 * С какого момента история ВСЕХ кошельков области полная. У активных адресов бэкфилл обрезан
 * лимитом страниц — норма по «дырявому» прошлому дала бы абсурдные «×400 000 к норме».
 * null — у кого-то история ещё не загружена.
 */
export function coverageStart(wallets: { historyFrom: Date | null }[]): Date | null {
  if (!wallets.length || wallets.some((w) => !w.historyFrom)) return null;
  return new Date(Math.max(...wallets.map((w) => w.historyFrom!.getTime())));
}

export async function getFlowWindows(addresses: string[], coverage: Date | null): Promise<FlowWindow[]> {
  const baseFrom = new Date(Math.max(Date.now() - 8 * 86_400_000, coverage?.getTime() ?? Date.now()));
  // Одним запросом: потоки за 1/4/24 ч и норма за предыдущие 7 суток
  const [row] = await prisma.$queryRaw<Record<string, number>[]>`
    WITH t AS (
      SELECT amount, "blockTimestamp" AS ts,
             "toAddress" = ANY(${addresses}::text[]) AND NOT "fromAddress" = ANY(${addresses}::text[]) AS is_in,
             "fromAddress" = ANY(${addresses}::text[]) AND NOT "toAddress" = ANY(${addresses}::text[]) AS is_out
      FROM "Transfer"
      WHERE "blockTimestamp" >= now() - interval '8 days'
        AND ("fromAddress" = ANY(${addresses}::text[]) OR "toAddress" = ANY(${addresses}::text[]))
    )
    SELECT
      coalesce(sum(amount) FILTER (WHERE is_in  AND ts >= now() - interval '1 hour'), 0)::float8   AS in1,
      coalesce(sum(amount) FILTER (WHERE is_out AND ts >= now() - interval '1 hour'), 0)::float8   AS out1,
      coalesce(sum(amount) FILTER (WHERE is_in  AND ts >= now() - interval '4 hours'), 0)::float8  AS in4,
      coalesce(sum(amount) FILTER (WHERE is_out AND ts >= now() - interval '4 hours'), 0)::float8  AS out4,
      coalesce(sum(amount) FILTER (WHERE is_in  AND ts >= now() - interval '24 hours'), 0)::float8 AS in24,
      coalesce(sum(amount) FILTER (WHERE is_out AND ts >= now() - interval '24 hours'), 0)::float8 AS out24,
      coalesce(sum(amount) FILTER (WHERE (is_in OR is_out)
                                     AND ts <  now() - interval '24 hours'
                                     AND ts >= ${baseFrom}), 0)::float8 AS base_gross
    FROM t`;

  // Норма — только по часам, где история всех кошельков полная; меньше суток — нормы нет
  const baseHours = Math.max(0, Math.min(168, (Date.now() - 86_400_000 - baseFrom.getTime()) / 3_600_000));
  return FLOW_WINDOWS.map((h) => {
    const inflow = row?.[`in${h}`] ?? 0;
    const outflow = row?.[`out${h}`] ?? 0;
    const gross = inflow + outflow;
    const baseline = baseHours >= 24 ? ((row?.base_gross ?? 0) / baseHours) * h : null;
    return {
      hours: h,
      inflow,
      outflow,
      net: inflow - outflow,
      gross,
      imbalance: gross > 0 ? (inflow - outflow) / gross : 0,
      intensity: baseline && baseline > 0 ? gross / baseline : null,
    };
  });
}

export interface FlowBucket {
  ts: number;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

export async function getFlowSeries(addresses: string[], range: SeriesRange): Promise<FlowBucket[]> {
  const { hours, bucket } = SERIES_RANGES[range];
  const tz = env().ANALYTICS_TZ;
  // Сетка интервалов в местном времени (сутки начинаются в полночь по Еревану), пустые — нулями
  const rows = await prisma.$queryRawUnsafe<{ b: Date; label: string; inflow: number; outflow: number }[]>(
    `WITH grid AS (
       SELECT generate_series(
         date_bin(interval '${bucket}', (now() - interval '${hours} hours') AT TIME ZONE $1, timestamp '2000-01-01'),
         date_bin(interval '${bucket}', now() AT TIME ZONE $1, timestamp '2000-01-01'),
         interval '${bucket}') AS b
     ),
     t AS (
       SELECT date_bin(interval '${bucket}', "blockTimestamp" AT TIME ZONE $1, timestamp '2000-01-01') AS b,
              sum(amount) FILTER (WHERE "toAddress" = ANY($2::text[]) AND NOT "fromAddress" = ANY($2::text[])) AS inflow,
              sum(amount) FILTER (WHERE "fromAddress" = ANY($2::text[]) AND NOT "toAddress" = ANY($2::text[])) AS outflow
       FROM "Transfer"
       WHERE "blockTimestamp" >= now() - interval '${hours + 24} hours'
         AND ("fromAddress" = ANY($2::text[]) OR "toAddress" = ANY($2::text[]))
       GROUP BY 1
     )
     SELECT grid.b AT TIME ZONE $1 AS b, to_char(grid.b, 'YYYY-MM-DD"T"HH24:MI') AS label,
            coalesce(t.inflow, 0)::float8 AS inflow, coalesce(t.outflow, 0)::float8 AS outflow
     FROM grid LEFT JOIN t USING (b)
     ORDER BY grid.b`,
    tz,
    addresses,
  );
  return rows.map((r) => ({ ts: new Date(r.b).getTime(), label: r.label, inflow: r.inflow, outflow: r.outflow, net: r.inflow - r.outflow }));
}

export interface WalletFlow {
  address: string;
  label: string;
  category: string;
  inflow: number;
  outflow: number;
  net: number;
}

/** Кто двигает рынок: кошельки рынка с наибольшим чистым потоком за 24 ч. */
export async function getTopMovers(addresses: string[], limit = 6): Promise<WalletFlow[]> {
  return prisma.$queryRaw<WalletFlow[]>`
    SELECT w.address, w.label, w.category::text AS category,
           coalesce(sum(t.amount) FILTER (WHERE t.dir = 'in'), 0)::float8 AS inflow,
           coalesce(sum(t.amount) FILTER (WHERE t.dir = 'out'), 0)::float8 AS outflow,
           (coalesce(sum(t.amount) FILTER (WHERE t.dir = 'in'), 0) - coalesce(sum(t.amount) FILTER (WHERE t.dir = 'out'), 0))::float8 AS net
    FROM "Wallet" w
    JOIN LATERAL (
      SELECT amount, 'in' AS dir FROM "Transfer"
       WHERE "toAddress" = w.address AND "blockTimestamp" >= now() - interval '24 hours'
         AND NOT "fromAddress" = ANY(${addresses}::text[])
      UNION ALL
      SELECT amount, 'out' FROM "Transfer"
       WHERE "fromAddress" = w.address AND "blockTimestamp" >= now() - interval '24 hours'
         AND NOT "toAddress" = ANY(${addresses}::text[])
    ) t ON true
    WHERE w.address = ANY(${addresses}::text[])
    GROUP BY w.address, w.label, w.category
    ORDER BY abs(coalesce(sum(t.amount) FILTER (WHERE t.dir = 'in'), 0) - coalesce(sum(t.amount) FILTER (WHERE t.dir = 'out'), 0)) DESC
    LIMIT ${limit}`;
}

export interface LiquiditySnapshot {
  scope: { kind: "market" | "all"; wallets: number; totalBalance: number };
  windows: FlowWindow[];
  pressureWindow: number;
  pressure: Pressure;
  velocity: { h24: number | null; avgDaily7d: number | null };
  series: FlowBucket[];
  movers: WalletFlow[];
}

export async function getLiquidity(opts: { scope?: "market" | "all"; window?: number; range?: SeriesRange } = {}): Promise<LiquiditySnapshot> {
  const scope = await marketScope(opts.scope);
  const window = (FLOW_WINDOWS as readonly number[]).includes(opts.window ?? 4) ? (opts.window ?? 4) : 4;
  const empty = !scope.addresses.length;
  // Средняя скорость — по дням с полной историей (минимум сутки, иначе сравнивать не с чем)
  const velocityFrom = new Date(Math.max(Date.now() - 7 * 86_400_000, scope.coverageStart?.getTime() ?? Date.now()));
  const velocityDays = (Date.now() - velocityFrom.getTime()) / 86_400_000;
  const [windows, series, movers, velocityRow] = await Promise.all([
    empty
      ? FLOW_WINDOWS.map((h) => ({ hours: h, inflow: 0, outflow: 0, net: 0, gross: 0, imbalance: 0, intensity: null }))
      : getFlowWindows(scope.addresses, scope.coverageStart),
    empty ? Promise.resolve([]) : getFlowSeries(scope.addresses, opts.range ?? "48h"),
    empty ? Promise.resolve([]) : getTopMovers(scope.addresses),
    // Скорость обращения: весь оборот кошельков (включая внутренние переводы) к их суммарному балансу
    empty
      ? Promise.resolve([{ v24: 0, v7: 0 }])
      : prisma.$queryRaw<{ v24: number; v7: number }[]>`
          SELECT coalesce(sum(amount) FILTER (WHERE "blockTimestamp" >= now() - interval '24 hours'), 0)::float8 AS v24,
                 coalesce(sum(amount) FILTER (WHERE "blockTimestamp" >= ${velocityFrom}), 0)::float8 AS v7
          FROM "Transfer"
          WHERE "blockTimestamp" >= now() - interval '7 days'
            AND ("fromAddress" = ANY(${scope.addresses}::text[]) OR "toAddress" = ANY(${scope.addresses}::text[]))`,
  ]);
  const w = windows.find((x) => x.hours === window)!;
  const bal = scope.totalBalance;
  return {
    scope: { kind: scope.kind, wallets: scope.wallets.length, totalBalance: bal },
    windows,
    pressureWindow: window,
    pressure: computePressure(w),
    velocity: {
      h24: bal > 0 ? velocityRow[0].v24 / bal : null,
      avgDaily7d: bal > 0 && velocityDays >= 1 ? velocityRow[0].v7 / velocityDays / bal : null,
    },
    series,
    movers,
  };
}
