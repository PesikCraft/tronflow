/**
 * Ingestion: TronGrid -> Postgres. Вызывается только воркером (веб ставит задачи в очередь Job).
 *
 *  backfillWallet   — история нового кошелька: от «сейчас» назад, не больше BACKFILL_MAX_PAGES
 *  syncWallet       — догрузка «вперёд» от syncCursor (режим poll и догон после простоя)
 *  tailFirehose     — поток Transfer-ивентов USDT, фильтр по адресной книге (режим firehose)
 *  refreshBalances  — balanceOf + TRX, снимок в историю
 *  expandAddress    — связи контрагента для 2-й степени на графе
 *
 * Все записи идемпотентны (skipDuplicates по уникальному ключу), окна намеренно перекрываются.
 */
import { prisma } from "./db";
import { env } from "./env";
import { getTronGrid } from "./tron/client";
import { getUsdtBalances, iterateAccountTransfers, iterateUsdtTransferEvents, type UsdtTransfer } from "./tron/usdt";
import type { JobType } from "../generated/prisma/client";

const OVERLAP_MS = 3 * 60_000;
/** Подтверждение (solidified block) на TRON занимает ~1 мин — не считаем последние секунды «просмотренными». */
const CONFIRMATION_LAG_MS = 90_000;
const FIREHOSE_KEY = "usdt_firehose_cursor";
/** Если firehose отстал сильнее — догоняем per-account, а не листаем миллионы чужих ивентов. */
const FIREHOSE_MAX_LAG_MS = 2 * 3_600_000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

export async function saveTransfers(transfers: UsdtTransfer[]): Promise<number> {
  // Нулевые переводы — почти всегда address poisoning (спам «похожими» адресами).
  const rows = transfers.filter((t) => t.amount !== "0");
  if (!rows.length) return 0;
  const res = await prisma.transfer.createMany({
    data: rows.map((t) => ({
      txHash: t.txHash,
      blockNumber: t.blockNumber != null ? BigInt(t.blockNumber) : null,
      blockTimestamp: new Date(t.blockTimestamp),
      fromAddress: t.from,
      toAddress: t.to,
      amount: t.amount,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

export interface SyncResult {
  address: string;
  inserted: number;
  pages: number;
  truncated?: boolean;
  error?: string;
}

/**
 * История нового кошелька. Сначала фиксируем курсор «вперёд» = момент старта
 * (дальше кошелёк ведёт firehose/poll), затем идём назад по времени до BACKFILL_DAYS
 * или лимита страниц — у биржевых адресов история в 30 дней может быть миллионами строк.
 */
export async function backfillWallet(address: string): Promise<SyncResult> {
  const { BACKFILL_DAYS, BACKFILL_MAX_PAGES } = env();
  const startedAt = Date.now();
  const since = startedAt - BACKFILL_DAYS * 86_400_000;
  const wallet = await prisma.wallet.update({
    where: { address },
    data: { syncCursor: new Date(startedAt - CONFIRMATION_LAG_MS) },
  });

  let inserted = 0;
  let pages = 0;
  let oldest = startedAt;
  try {
    for await (const page of iterateAccountTransfers(getTronGrid(), address, {
      since,
      until: startedAt,
      order: "desc",
      maxPages: BACKFILL_MAX_PAGES,
    })) {
      pages++;
      inserted += await saveTransfers(page);
      oldest = Math.min(oldest, page[page.length - 1].blockTimestamp);
    }
    const truncated = pages >= BACKFILL_MAX_PAGES;
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        backfilledAt: new Date(),
        historyFrom: new Date(truncated ? oldest : since),
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });
    return { address, inserted, pages, truncated };
  } catch (err) {
    await prisma.wallet.update({ where: { id: wallet.id }, data: { syncError: errorText(err) } });
    return { address, inserted, pages, error: errorText(err) };
  }
}

/** Догрузка «вперёд» от syncCursor. Курсор двигается постранично — прерванная синхронизация продолжится. */
export async function syncWallet(address: string, maxPages = 50): Promise<SyncResult> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { address } });
  if (!wallet.syncCursor || !wallet.backfilledAt) return backfillWallet(address);

  const startedAt = Date.now();
  let cursor = wallet.syncCursor.getTime();
  let inserted = 0;
  let pages = 0;
  try {
    for await (const page of iterateAccountTransfers(getTronGrid(), address, {
      since: cursor - OVERLAP_MS,
      order: "asc",
      maxPages,
    })) {
      pages++;
      inserted += await saveTransfers(page);
      cursor = Math.max(cursor, page[page.length - 1].blockTimestamp);
      await prisma.wallet.update({ where: { id: wallet.id }, data: { syncCursor: new Date(cursor) } });
    }
    const truncated = pages >= maxPages;
    if (!truncated) cursor = Math.max(cursor, startedAt - CONFIRMATION_LAG_MS);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { syncCursor: new Date(cursor), lastSyncedAt: new Date(), syncError: null },
    });
    return { address, inserted, pages, truncated };
  } catch (err) {
    await prisma.wallet.update({ where: { id: wallet.id }, data: { syncError: errorText(err) } });
    return { address, inserted, pages, error: errorText(err) };
  }
}

/** Кошельки, для которых ещё не загружена история. */
export async function pendingBackfills(limit = 5) {
  return prisma.wallet.findMany({
    where: { isWatched: true, backfilledAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { address: true },
  });
}

/** Режим poll: кошельки, которые пора опросить. */
export async function pollDueWallets(limit = 20): Promise<SyncResult[]> {
  const due = await prisma.wallet.findMany({
    where: {
      isWatched: true,
      backfilledAt: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - env().POLL_INTERVAL_SEC * 1000) } }],
    },
    orderBy: { lastSyncedAt: "asc" },
    take: limit,
    select: { address: true },
  });
  const results: SyncResult[] = [];
  for (const w of due) results.push(await syncWallet(w.address));
  return results;
}

/**
 * Один тик firehose: ивенты контракта USDT от сохранённого курсора, в БД — только
 * касающиеся адресной книги. Стоимость ~12k запросов/сутки независимо от числа кошельков.
 */
export async function tailFirehose(maxPages = 40) {
  const watchedList = await prisma.wallet.findMany({ where: { isWatched: true }, select: { address: true } });
  if (!watchedList.length) return { inserted: 0, scanned: 0, lagMs: 0 };
  const watched = new Set(watchedList.map((w) => w.address));

  const state = await prisma.syncState.findUnique({ where: { key: FIREHOSE_KEY } });
  let cursor = state ? Number(state.value) : Date.now() - 5 * 60_000;

  if (Date.now() - cursor > FIREHOSE_MAX_LAG_MS) {
    // Долгий простой (Mac спал / был выключен): догоняем per-account от syncCursor каждого кошелька.
    const backfilled = await prisma.wallet.findMany({
      where: { isWatched: true, backfilledAt: { not: null } },
      select: { address: true },
    });
    for (const w of backfilled) await syncWallet(w.address, 200);
    cursor = Date.now() - 5 * 60_000;
  }

  let inserted = 0;
  let scanned = 0;
  for await (const page of iterateUsdtTransferEvents(getTronGrid(), {
    since: cursor, // inclusive: граничный блок перечитывается, дубликаты отсекаются уникальным ключом
    maxPages,
    filter: (t) => watched.has(t.from) || watched.has(t.to),
  })) {
    scanned += page.scanned;
    inserted += await saveTransfers(page.transfers);
    if (page.lastTimestamp) {
      cursor = Math.max(cursor, page.lastTimestamp);
      await setState(FIREHOSE_KEY, String(cursor));
    }
  }

  // Per-account курсоры следуют за firehose — при переключении в poll не будет повторной загрузки.
  await prisma.wallet.updateMany({
    where: { isWatched: true, backfilledAt: { not: null }, syncCursor: { lt: new Date(cursor) } },
    data: { syncCursor: new Date(cursor), lastSyncedAt: new Date() },
  });
  return { inserted, scanned, lagMs: Date.now() - cursor };
}

/** Балансы USDT/TRX + снимок в историю. */
export async function refreshBalances(addresses: string[]) {
  if (!addresses.length) return [];
  const wallets = await prisma.wallet.findMany({
    where: { address: { in: addresses } },
    select: { id: true, address: true },
  });
  const results = await getUsdtBalances(getTronGrid(), wallets.map((w) => w.address), { includeTrx: true });
  const idByAddress = new Map(wallets.map((w) => [w.address, w.id]));
  const now = new Date();

  for (const r of results) {
    const walletId = idByAddress.get(r.address)!;
    if (r.usdt === null) {
      await prisma.wallet.update({ where: { id: walletId }, data: { syncError: `balance: ${r.error}` } });
      continue;
    }
    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: walletId },
        data: { usdtBalance: r.usdt, trxBalance: r.trx ?? undefined, balanceUpdatedAt: now },
      }),
      prisma.balanceSnapshot.create({ data: { walletId, usdt: r.usdt, trx: r.trx ?? undefined, takenAt: now } }),
    ]);
  }
  return results;
}

/** Кошельки, у которых баланса ещё нет вовсе (только что добавлены) — в начале цикла, не дожидаясь истории. */
export async function refreshMissingBalances(limit = 20) {
  const rows = await prisma.wallet.findMany({
    where: { isWatched: true, balanceUpdatedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { address: true },
  });
  return refreshBalances(rows.map((r) => r.address));
}

/**
 * Балансы меняются только при переводах — обновляем кошельки, у которых появились
 * новые переводы после последнего замера, плюс плановый проход раз в BALANCE_SWEEP_HOURS
 * (TRX тратится на комиссии без USDT-переводов).
 */
export async function refreshStaleBalances(limit = 50) {
  const rows = await prisma.$queryRaw<{ address: string }[]>`
    SELECT w.address FROM "Wallet" w
    WHERE w."isWatched" AND (
      w."balanceUpdatedAt" IS NULL
      OR w."balanceUpdatedAt" < now() - make_interval(hours => ${env().BALANCE_SWEEP_HOURS}::int)
      OR EXISTS (SELECT 1 FROM "Transfer" t WHERE t."toAddress" = w.address AND t."blockTimestamp" > w."balanceUpdatedAt")
      OR EXISTS (SELECT 1 FROM "Transfer" t WHERE t."fromAddress" = w.address AND t."blockTimestamp" > w."balanceUpdatedAt")
    )
    ORDER BY w."balanceUpdatedAt" ASC NULLS FIRST
    LIMIT ${limit}`;
  return refreshBalances(rows.map((r) => r.address));
}

/**
 * Связи контрагента (2-я степень на графе): последние переводы за 30 дней, не больше 5 страниц.
 * Адрес сохраняется как неотслеживаемый (isWatched=false) — firehose его не фильтрует.
 */
export async function expandAddress(address: string) {
  await prisma.wallet.upsert({
    where: { address },
    create: { address, label: `${address.slice(0, 6)}…${address.slice(-4)}`, isWatched: false },
    update: {},
  });
  let inserted = 0;
  let fetched = 0;
  for await (const page of iterateAccountTransfers(getTronGrid(), address, {
    since: Date.now() - 30 * 86_400_000,
    order: "desc",
    maxPages: 5,
  })) {
    fetched += page.length;
    inserted += await saveTransfers(page);
  }
  await refreshBalances([address]);
  return { address, fetched, inserted };
}

// ---------------------------------------------------------------------------
// Очередь задач
// ---------------------------------------------------------------------------

/** Ставит задачу; если такая же уже ждёт/выполняется — возвращает её. */
export async function enqueueJob(type: JobType, address: string) {
  const existing = await prisma.job.findFirst({
    where: { type, address, status: { in: ["PENDING", "RUNNING"] } },
  });
  return existing ?? prisma.job.create({ data: { type, address } });
}

/** Берёт следующую задачу атомарно (безопасно даже при двух воркерах). */
async function claimJob() {
  const rows = await prisma.$queryRaw<{ id: number; type: JobType; address: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "startedAt" = now()
    WHERE id = (SELECT id FROM "Job" WHERE status = 'PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, type, address`;
  return rows[0];
}

export async function processJobs(timeBudgetMs: number) {
  const deadline = Date.now() + timeBudgetMs;
  let done = 0;
  while (Date.now() < deadline) {
    const job = await claimJob();
    if (!job) break;
    try {
      let result: unknown;
      if (job.type === "SYNC") {
        result = await syncWallet(job.address);
        await refreshBalances([job.address]);
      } else if (job.type === "EXPAND") {
        result = await expandAddress(job.address);
      } else {
        result = await refreshBalances([job.address]);
      }
      const failed = (result as SyncResult | undefined)?.error;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: failed ? "FAILED" : "DONE",
          error: failed ?? null,
          result: JSON.parse(JSON.stringify(result)),
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", error: errorText(err), finishedAt: new Date() },
      });
    }
    done++;
  }
  return done;
}

/** После падения воркера «зависшие» RUNNING-задачи возвращаются в очередь. */
export async function requeueStaleJobs() {
  await prisma.job.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING", startedAt: null } });
  // История задач старше 7 дней не нужна
  await prisma.job.deleteMany({ where: { finishedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
}

/**
 * Очистка старых данных, чтобы база не выросла за лимит бесплатного тарифа.
 * Переводы и снимки балансов старше retentionDays удаляются; журнал уведомлений — старше 60 дней.
 */
export async function pruneOldData(retentionDays: number) {
  const result = { transfers: 0, snapshots: 0, alertEvents: 0 };
  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    // Пачками, чтобы не держать долгую блокировку таблицы
    for (;;) {
      const n = await prisma.$executeRaw`
        DELETE FROM "Transfer" WHERE id IN (
          SELECT id FROM "Transfer" WHERE "blockTimestamp" < ${cutoff} LIMIT 20000)`;
      result.transfers += n;
      if (n < 20000) break;
    }
    result.snapshots = (await prisma.balanceSnapshot.deleteMany({ where: { takenAt: { lt: cutoff } } })).count;
    // Кошельки, чья история теперь начинается позже: «история с …» должна говорить правду
    await prisma.wallet.updateMany({ where: { historyFrom: { lt: cutoff } }, data: { historyFrom: cutoff } });
  }
  result.alertEvents = (
    await prisma.alertEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60 * 86_400_000) } } })
  ).count;
  return result;
}

// ---------------------------------------------------------------------------
// Состояние и учёт лимитов
// ---------------------------------------------------------------------------

export async function setState(key: string, value: string) {
  await prisma.syncState.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getState(key: string) {
  return (await prisma.syncState.findUnique({ where: { key } }))?.value ?? null;
}

const usageKey = () => `trongrid_requests:${new Date().toISOString().slice(0, 10)}`;

export async function addUsage(delta: number) {
  if (delta <= 0) return;
  await prisma.$executeRaw`
    INSERT INTO "SyncState" (key, value, "updatedAt") VALUES (${usageKey()}, ${String(delta)}, now())
    ON CONFLICT (key) DO UPDATE SET value = ("SyncState".value::bigint + ${delta})::text, "updatedAt" = now()`;
}

export async function usageToday(): Promise<number> {
  return Number((await getState(usageKey())) ?? 0);
}
