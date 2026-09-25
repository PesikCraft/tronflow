/**
 * Фоновый воркер: единственный процесс, который ходит в TronGrid.
 *   npm run worker
 *
 * Каждый тик (WORKER_TICK_SEC):
 *   1. задачи из очереди (синхронизация / раскрытие узла / баланс по кнопке из UI)
 *   2. бэкфилл истории новых кошельков
 *   3. новые переводы: firehose (по умолчанию) или poll
 *   4. балансы кошельков, у которых были переводы, + плановый проход
 *   5. скан паттернов (раз в PATTERN_SCAN_MIN) и уведомления в Telegram
 * Состояние пишется в SyncState (worker_status) — дашборд показывает, жив ли воркер и какой лаг.
 */
import "dotenv/config";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import {
  addUsage,
  backfillWallet,
  pendingBackfills,
  pollDueWallets,
  processJobs,
  pruneOldData,
  refreshBalances,
  refreshMissingBalances,
  refreshStaleBalances,
  requeueStaleJobs,
  setState,
  tailFirehose,
  usageToday,
} from "../src/lib/ingest";
import { getTronGrid } from "../src/lib/tron/client";
import { pgConnection } from "../src/lib/pg-config";
import { runAlerts } from "../src/lib/alerts/engine";
import { scanAndStore } from "../src/lib/patterns/scan";

const LOCK_ID = 73_100_001; // произвольный, но постоянный ключ pg_advisory_lock

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === "error" ? console.error : console.log)(line);
}

let stopping = false;
let wake: (() => void) | undefined;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log("info", `received ${sig}, finishing current tick`);
    stopping = true;
    wake?.();
  });
}

async function acquireLock(): Promise<pg.Client> {
  const client = new pg.Client(pgConnection(env().DATABASE_URL));
  await client.connect();
  for (;;) {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID]);
    if (rows[0].ok) return client; // лок держится, пока жив этот коннект
    if (stopping) process.exit(0);
    log("warn", "another worker holds the lock, waiting");
    await sleep(30_000);
  }
}

let lastPatternScan = 0;
let lastPrune = 0;
let lastKeepalive = 0;

async function tick() {
  const e = env();
  const used = await usageToday();
  const overBudget = used >= e.TRONGRID_DAILY_BUDGET;
  if (overBudget) log("warn", "daily TronGrid budget reached: only live ingestion and balances", { used });

  const jobs = overBudget ? 0 : await processJobs(60_000);

  // Новые кошельки сразу получают баланс — сводка «сколько денег на кошельках» заполняется за минуту
  await refreshMissingBalances();

  let backfills = 0;
  if (!overBudget) {
    const fresh: string[] = [];
    for (const w of await pendingBackfills(2)) {
      const r = await backfillWallet(w.address);
      backfills++;
      fresh.push(w.address);
      log(r.error ? "error" : "info", "backfill", { ...r });
    }
    // Баланс нового кошелька — сразу, а не после догонки потока (без ключа это минуты)
    if (fresh.length) await refreshBalances(fresh);
  }

  let ingest: Record<string, unknown>;
  if (e.INGEST_MODE === "firehose") {
    ingest = await tailFirehose();
  } else {
    const results = await pollDueWallets();
    ingest = {
      polled: results.length,
      inserted: results.reduce((s, r) => s + r.inserted, 0),
      errors: results.filter((r) => r.error).length,
    };
  }

  const balances = (await refreshStaleBalances(overBudget ? 10 : 50)).length;

  // Паттерны и уведомления работают только с базой — лимит TronGrid их не касается
  let patterns: Record<string, unknown> | undefined;
  if (Date.now() - lastPatternScan >= e.PATTERN_SCAN_MIN * 60_000) {
    lastPatternScan = Date.now();
    patterns = { ...(await scanAndStore(e.PATTERN_SCAN_DAYS)) };
    log("info", "pattern scan", patterns);
  }
  const alerts = await runAlerts();
  if (alerts.events) log("info", "alerts", { ...alerts });

  // Раз в 6 часов — очистка старых данных (если задан срок хранения)
  if (Date.now() - lastPrune >= 6 * 3_600_000) {
    lastPrune = Date.now();
    const pruned = await pruneOldData(e.TRANSFER_RETENTION_DAYS);
    if (pruned.transfers || pruned.snapshots || pruned.alertEvents) log("info", "prune", pruned);
  }

  // Бесплатный Render усыпляет сервис без входящих запросов через 15 минут — будим сами себя
  const keepalive = e.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (keepalive && Date.now() - lastKeepalive >= 10 * 60_000) {
    lastKeepalive = Date.now();
    await fetch(`${keepalive.replace(/\/$/, "")}/login`, { signal: AbortSignal.timeout(15_000) }).catch((err) =>
      log("warn", "keepalive failed", { message: String(err) }),
    );
  }

  return { jobs, backfills, balances, ingest, overBudget, alerts, patterns };
}

async function main() {
  const e = env(); // падаем сразу при кривом .env
  const lock = await acquireLock();
  await requeueStaleJobs();
  // Отметка сразу при старте: первый цикл (догонка сети) может идти минуту и дольше
  await setState("worker_status", JSON.stringify({ at: Date.now(), mode: e.INGEST_MODE, starting: true, ingest: {} }));
  log("info", "worker started", { mode: e.INGEST_MODE, tickSec: e.WORKER_TICK_SEC, apiKey: Boolean(e.TRONGRID_API_KEY) });

  const tg = getTronGrid();
  while (!stopping) {
    const started = Date.now();
    const before = tg.requests;
    try {
      const summary = await tick();
      const requests = tg.requests - before;
      await addUsage(tg.requests - before);
      await setState(
        "worker_status",
        JSON.stringify({ at: Date.now(), mode: e.INGEST_MODE, durationMs: Date.now() - started, requests, ...summary }),
      );
      if (summary.jobs || summary.backfills || (summary.ingest.inserted as number) > 0) {
        log("info", "tick", { durationMs: Date.now() - started, requests, ...summary });
      }
    } catch (err) {
      await addUsage(tg.requests - before).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      log("error", "tick failed", { message, stack: err instanceof Error ? err.stack : undefined });
      await setState("worker_last_error", JSON.stringify({ at: Date.now(), message })).catch(() => {});
    }
    const wait = e.WORKER_TICK_SEC * 1000 - (Date.now() - started);
    if (wait > 0 && !stopping) await sleep(wait);
  }

  await lock.end();
  await prisma.$disconnect();
  log("info", "worker stopped");
}

main().catch((err) => {
  log("error", "worker crashed", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
