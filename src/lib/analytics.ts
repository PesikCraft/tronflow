/**
 * Агрегаты оборота за период — чистый SQL (Postgres считает быстрее и точнее,
 * чем выгрузка строк в Node). Суммы отдаются как float8: для отображения
 * этого достаточно, точные значения остаются в NUMERIC в самой таблице.
 */
import { prisma } from "./db";
import { env } from "./env";

export const PERIODS = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
export type Period = keyof typeof PERIODS;

export function parsePeriod(v: string | null | undefined, fallback: Period = "7d"): Period {
  return v && v in PERIODS ? (v as Period) : fallback;
}

export function periodStart(p: Period): Date {
  return new Date(Date.now() - PERIODS[p] * 86_400_000);
}

const TZ = () => env().ANALYTICS_TZ;

export interface Summary {
  txCount: number;
  totalVolume: number;
  avgSize: number;
  medianSize: number;
  inflow: number;
  outflow: number;
  internal: number;
  uniqueCounterparties: number;
}

export interface Bucket {
  key: number | string;
  count: number;
  volume: number;
}

export interface WalletStats {
  address: string;
  label: string;
  category: string;
  usdtBalance: number | null;
  balanceUpdatedAt: Date | null;
  inflow: number;
  outflow: number;
  txCount: number;
  counterparties: number;
  lastActivity: Date | null;
  syncError: string | null;
  backfilledAt: Date | null;
  historyFrom: Date | null;
}

async function watchedAddresses(): Promise<string[]> {
  const rows = await prisma.wallet.findMany({ where: { isWatched: true }, select: { address: true } });
  return rows.map((r) => r.address);
}

/**
 * Сводка по «области» (все отслеживаемые кошельки или один адрес).
 * Перевод между двумя кошельками области считается один раз и попадает в `internal`,
 * а не в приток+отток — иначе оборот рынка задваивается.
 */
export async function getSummary(period: Period, scope?: string[]): Promise<Summary> {
  const addrs = scope ?? (await watchedAddresses());
  const since = periodStart(period);
  const [row] = await prisma.$queryRaw<Summary[]>`
    WITH t AS (
      SELECT amount, "fromAddress", "toAddress",
             "fromAddress" = ANY(${addrs}::text[]) AS is_out,
             "toAddress"   = ANY(${addrs}::text[]) AS is_in
      FROM "Transfer"
      WHERE "blockTimestamp" >= ${since}
        AND ("fromAddress" = ANY(${addrs}::text[]) OR "toAddress" = ANY(${addrs}::text[]))
    )
    SELECT
      count(*)::int                                                          AS "txCount",
      coalesce(sum(amount), 0)::float8                                       AS "totalVolume",
      coalesce(avg(amount), 0)::float8                                       AS "avgSize",
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), 0)::float8 AS "medianSize",
      coalesce(sum(amount) FILTER (WHERE is_in AND NOT is_out), 0)::float8   AS "inflow",
      coalesce(sum(amount) FILTER (WHERE is_out AND NOT is_in), 0)::float8   AS "outflow",
      coalesce(sum(amount) FILTER (WHERE is_in AND is_out), 0)::float8       AS "internal",
      count(DISTINCT CASE WHEN is_in AND is_out THEN NULL
                          WHEN is_out THEN "toAddress" ELSE "fromAddress" END)::int AS "uniqueCounterparties"
    FROM t`;
  return row;
}

/** Активность по часу суток (0–23) или дню недели (1=Пн … 7=Вс) в локальном часовом поясе. */
export async function getActivityProfile(
  period: Period,
  by: "hour" | "isodow",
  scope?: string[],
): Promise<Bucket[]> {
  const addrs = scope ?? (await watchedAddresses());
  const since = periodStart(period);
  const field = by === "hour" ? "hour" : "isodow";
  const rows = await prisma.$queryRawUnsafe<Bucket[]>(
    `SELECT extract(${field} FROM "blockTimestamp" AT TIME ZONE $1)::int AS key,
            count(*)::int AS count, sum(amount)::float8 AS volume
     FROM "Transfer"
     WHERE "blockTimestamp" >= $2 AND ("fromAddress" = ANY($3::text[]) OR "toAddress" = ANY($3::text[]))
     GROUP BY 1 ORDER BY 1`,
    TZ(),
    since,
    addrs,
  );
  // Дозаполняем пустые часы/дни нулями — на графике «тишина» тоже информация.
  const keys = by === "hour" ? [...Array(24).keys()] : [1, 2, 3, 4, 5, 6, 7];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map((k) => byKey.get(k) ?? { key: k, count: 0, volume: 0 });
}

/** Временной ряд объёма: по часам для 1d, по дням для остальных периодов; пустые интервалы — нули. */
export async function getVolumeSeries(period: Period, scope?: string[]): Promise<Bucket[]> {
  const addrs = scope ?? (await watchedAddresses());
  const since = periodStart(period);
  const unit = period === "1d" ? "hour" : "day";
  return prisma.$queryRawUnsafe<Bucket[]>(
    `WITH buckets AS (
       SELECT generate_series(date_trunc('${unit}', $2::timestamptz AT TIME ZONE $1),
                              date_trunc('${unit}', now() AT TIME ZONE $1),
                              interval '1 ${unit}') AS b
     ),
     agg AS (
       SELECT date_trunc('${unit}', "blockTimestamp" AT TIME ZONE $1) AS b, count(*) AS n, sum(amount) AS v
       FROM "Transfer"
       WHERE "blockTimestamp" >= $2 AND ("fromAddress" = ANY($3::text[]) OR "toAddress" = ANY($3::text[]))
       GROUP BY 1
     )
     SELECT to_char(buckets.b, 'YYYY-MM-DD"T"HH24:MI') AS key,
            coalesce(agg.n, 0)::int AS count, coalesce(agg.v, 0)::float8 AS volume
     FROM buckets LEFT JOIN agg USING (b)
     ORDER BY buckets.b`,
    TZ(),
    since,
    addrs,
  );
}

/** Таблица по кошелькам адресной книги. LATERAL + UNION ALL — чтобы работали индексы по from/to. */
export async function getWalletStats(period: Period): Promise<WalletStats[]> {
  const since = periodStart(period);
  return prisma.$queryRaw<WalletStats[]>`
    SELECT w.address, w.label, w.category::text AS category,
           w."usdtBalance"::float8 AS "usdtBalance", w."balanceUpdatedAt", w."syncError",
           w."backfilledAt", w."historyFrom",
           coalesce(sum(t.amount) FILTER (WHERE t.dir = 'in'), 0)::float8  AS inflow,
           coalesce(sum(t.amount) FILTER (WHERE t.dir = 'out'), 0)::float8 AS outflow,
           count(t.amount)::int AS "txCount",
           count(DISTINCT t.cp)::int AS counterparties,
           max(t.ts) AS "lastActivity"
    FROM "Wallet" w
    LEFT JOIN LATERAL (
      SELECT amount, 'in' AS dir, "fromAddress" AS cp, "blockTimestamp" AS ts
        FROM "Transfer" WHERE "toAddress" = w.address AND "blockTimestamp" >= ${since}
      UNION ALL
      SELECT amount, 'out', "toAddress", "blockTimestamp"
        FROM "Transfer" WHERE "fromAddress" = w.address AND "blockTimestamp" >= ${since}
    ) t ON true
    WHERE w."isWatched"
    GROUP BY w.id
    ORDER BY coalesce(sum(t.amount), 0) DESC, w.label`;
}

export interface TransferRow {
  txHash: string;
  blockTimestamp: Date;
  fromAddress: string;
  toAddress: string;
  amount: number;
  fromLabel: string | null;
  toLabel: string | null;
}

export async function getTransfers(
  opts: { limit?: number; offset?: number; address?: string; since?: Date } = {},
): Promise<TransferRow[]> {
  const addrs = opts.address ? [opts.address] : await watchedAddresses();
  const since = opts.since ?? new Date(0);
  return prisma.$queryRaw<TransferRow[]>`
    SELECT t."txHash", t."blockTimestamp", t."fromAddress", t."toAddress", t.amount::float8 AS amount,
           wf.label AS "fromLabel", wt.label AS "toLabel"
    FROM "Transfer" t
    LEFT JOIN "Wallet" wf ON wf.address = t."fromAddress"
    LEFT JOIN "Wallet" wt ON wt.address = t."toAddress"
    WHERE (t."fromAddress" = ANY(${addrs}::text[]) OR t."toAddress" = ANY(${addrs}::text[]))
      AND t."blockTimestamp" >= ${since}
    ORDER BY t."blockTimestamp" DESC
    LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}`;
}

export interface Counterparty {
  address: string;
  label: string | null;
  category: string | null;
  inflow: number; // от контрагента к кошельку
  outflow: number; // от кошелька к контрагенту
  txCount: number;
  lastTs: Date;
}

export async function getTopCounterparties(address: string, period: Period, limit = 20): Promise<Counterparty[]> {
  const since = periodStart(period);
  return prisma.$queryRaw<Counterparty[]>`
    SELECT c.cp AS address, w.label, w.category::text AS category,
           coalesce(sum(c.amount) FILTER (WHERE c.dir = 'in'), 0)::float8  AS inflow,
           coalesce(sum(c.amount) FILTER (WHERE c.dir = 'out'), 0)::float8 AS outflow,
           count(*)::int AS "txCount", max(c.ts) AS "lastTs"
    FROM (
      SELECT "fromAddress" AS cp, amount, 'in' AS dir, "blockTimestamp" AS ts
        FROM "Transfer" WHERE "toAddress" = ${address} AND "blockTimestamp" >= ${since}
      UNION ALL
      SELECT "toAddress", amount, 'out', "blockTimestamp"
        FROM "Transfer" WHERE "fromAddress" = ${address} AND "blockTimestamp" >= ${since}
    ) c
    LEFT JOIN "Wallet" w ON w.address = c.cp
    GROUP BY c.cp, w.label, w.category
    ORDER BY sum(c.amount) DESC
    LIMIT ${limit}`;
}

export async function getBalanceHistory(address: string, period: Period) {
  const rows = await prisma.balanceSnapshot.findMany({
    where: { wallet: { address }, takenAt: { gte: periodStart(period) } },
    orderBy: { takenAt: "asc" },
    select: { takenAt: true, usdt: true },
  });
  return rows.map((r) => ({ ts: r.takenAt.getTime(), usdt: Number(r.usdt) }));
}

/**
 * Переводы для графа. Без focus — крупнейшие переводы периода по всей базе
 * (там только переводы адресной книги и раскрытых узлов). С focus — окрестность
 * адреса в 2 шага. Лимит: граф > ~3k рёбер нечитаем.
 */
export async function getGraphData(
  period: Period,
  opts: { minAmount?: number; focus?: string; limit?: number } = {},
) {
  const since = periodStart(period);
  const minAmount = opts.minAmount ?? 0;
  const limit = opts.limit ?? 15_000;
  type Row = { txHash: string; from: string; to: string; amount: number; ts: Date };

  const transfers = opts.focus
    ? await prisma.$queryRaw<Row[]>`
        WITH hood AS (
          SELECT ${opts.focus}::text AS a
          UNION
          SELECT CASE WHEN "fromAddress" = ${opts.focus} THEN "toAddress" ELSE "fromAddress" END
          FROM "Transfer"
          WHERE ("fromAddress" = ${opts.focus} OR "toAddress" = ${opts.focus})
            AND "blockTimestamp" >= ${since} AND amount >= ${minAmount}
        )
        SELECT "txHash", "fromAddress" AS "from", "toAddress" AS "to", amount::float8 AS amount, "blockTimestamp" AS ts
        FROM "Transfer"
        WHERE "blockTimestamp" >= ${since} AND amount >= ${minAmount}
          AND ("fromAddress" IN (SELECT a FROM hood) OR "toAddress" IN (SELECT a FROM hood))
        ORDER BY amount DESC
        LIMIT ${limit}`
    : await prisma.$queryRaw<Row[]>`
        SELECT "txHash", "fromAddress" AS "from", "toAddress" AS "to", amount::float8 AS amount, "blockTimestamp" AS ts
        FROM "Transfer"
        WHERE "blockTimestamp" >= ${since} AND amount >= ${minAmount}
        ORDER BY amount DESC
        LIMIT ${limit}`;

  const addresses = new Set<string>();
  for (const t of transfers) addresses.add(t.from).add(t.to);
  const wallets = await prisma.wallet.findMany({
    where: { OR: [{ isWatched: true }, { address: { in: [...addresses] } }] },
    select: { address: true, label: true, category: true, isWatched: true, usdtBalance: true },
  });
  return {
    transfers: transfers.map((t) => ({ ...t, ts: t.ts.getTime() })),
    wallets: wallets.map((w) => ({ ...w, usdtBalance: w.usdtBalance == null ? null : Number(w.usdtBalance) })),
    truncated: transfers.length === limit,
  };
}

export interface SystemStatus {
  worker: {
    at: number;
    mode: string;
    durationMs: number;
    requests: number;
    overBudget: boolean;
    ingest: { lagMs?: number; inserted?: number };
  } | null;
  lastError: { at: number; message: string } | null;
  requestsToday: number;
  dailyBudget: number;
  pendingJobs: number;
  pendingBackfills: number;
  walletErrors: number;
  transferCount: number;
  dbSizeBytes: number;
  dbLimitMb: number;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const today = `trongrid_requests:${new Date().toISOString().slice(0, 10)}`;
  const [states, pendingJobs, pendingBackfills, walletErrors, [{ estimate }], [{ size }]] = await Promise.all([
    prisma.syncState.findMany({ where: { key: { in: ["worker_status", "worker_last_error", today] } } }),
    prisma.job.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.wallet.count({ where: { isWatched: true, backfilledAt: null } }),
    prisma.wallet.count({ where: { isWatched: true, syncError: { not: null } } }),
    // точный count(*) по миллионам строк медленный — берём оценку планировщика
    prisma.$queryRaw<{ estimate: number }[]>`
      SELECT greatest(reltuples, 0)::float8 AS estimate FROM pg_class WHERE relname = 'Transfer'`,
    prisma.$queryRaw<{ size: number }[]>`SELECT pg_database_size(current_database())::float8 AS size`,
  ]);
  const get = (k: string) => states.find((s) => s.key === k)?.value;
  return {
    worker: get("worker_status") ? JSON.parse(get("worker_status")!) : null,
    lastError: get("worker_last_error") ? JSON.parse(get("worker_last_error")!) : null,
    requestsToday: Number(get(today) ?? 0),
    dailyBudget: env().TRONGRID_DAILY_BUDGET,
    pendingJobs,
    pendingBackfills,
    walletErrors,
    transferCount: estimate ?? 0,
    dbSizeBytes: size ?? 0,
    dbLimitMb: env().DB_SIZE_LIMIT_MB,
  };
}
