/**
 * Движок уведомлений. Вызывается воркером каждый тик:
 *   1. новые «живые» переводы (не старше LIVE_WINDOW) -> правила WHALE и NEW_COUNTERPARTY;
 *   2. скользящее окно объёма -> VOLUME_SPIKE (не чаще cooldownMin);
 *   3. новые находки сканера паттернов -> PATTERN.
 * Каждое событие пишется в AlertEvent с уникальным dedupeKey — повторов не бывает,
 * даже если воркер перезапустился посреди отправки.
 */
import { prisma } from "../db";
import type { AlertRule } from "../../generated/prisma/client";
import { getState, setState } from "../ingest";
import { sendTelegram, telegramChatId, telegramToken } from "../telegram";
import {
  digestLine,
  digestMessage,
  newCounterpartyMessage,
  patternMessage,
  spikeMessage,
  whaleMessage,
  type LinkCtx,
  type TransferInfo,
} from "./messages";
import { parseParams, type AlertTypeName, type RuleParams } from "./rules";

/** Переводы старше этого — история/бэкфилл, о них не уведомляем. */
const LIVE_WINDOW_MS = 20 * 60_000;
const TRANSFER_CURSOR = "alerts_transfer_cursor";
const PATTERN_CURSOR = "alerts_pattern_cursor";
/** Больше событий одного правила за цикл — одна сводка вместо пачки сообщений. */
const DIGEST_THRESHOLD = 5;

export type Sender = (html: string) => Promise<void>;

interface PendingEvent {
  rule: AlertRule;
  dedupeKey: string;
  title: string;
  message: string;
  digestLine?: string;
}

export interface AlertRunResult {
  events: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Адреса области правила: явные адреса + кошельки категорий; пусто — вся адресная книга. */
async function ruleScope(rule: AlertRule, watched: { address: string; category: string }[]) {
  if (!rule.addresses.length && !rule.categories.length) return new Set(watched.map((w) => w.address));
  const set = new Set(rule.addresses);
  for (const w of watched) if (rule.categories.includes(w.category)) set.add(w.address);
  return set;
}

export async function runAlerts(opts: { send?: Sender; now?: Date } = {}): Promise<AlertRunResult> {
  const now = opts.now ?? new Date();
  const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
  const watched = await prisma.wallet.findMany({
    where: { isWatched: true },
    select: { address: true, category: true, label: true, backfilledAt: true, historyFrom: true },
  });
  const labels = new Map(
    (await prisma.wallet.findMany({ select: { address: true, label: true } })).map((w) => [w.address, w.label]),
  );
  const ctx: LinkCtx = { dashboardUrl: (process.env.DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, "") || null };
  const pending: PendingEvent[] = [];

  // --- 1. Новые переводы -------------------------------------------------------
  const cursorRaw = await getState(TRANSFER_CURSOR);
  const maxId = (await prisma.transfer.aggregate({ _max: { id: true } }))._max.id ?? 0n;
  if (cursorRaw === null) {
    await setState(TRANSFER_CURSOR, String(maxId)); // первый запуск: о прошлом не уведомляем
  } else {
    const transfers = await prisma.transfer.findMany({
      where: { id: { gt: BigInt(cursorRaw) }, blockTimestamp: { gte: new Date(now.getTime() - LIVE_WINDOW_MS) } },
      orderBy: { id: "asc" },
      take: 5000,
    });
    const transferRules = rules.filter((r) => r.type === "WHALE" || r.type === "NEW_COUNTERPARTY");
    // «Новизну» адреса можно судить, только зная хотя бы неделю истории кошелька.
    // У очень активных адресов история обрезана до минут — там любой контрагент выглядел бы «новым».
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const historyReady = new Set(
      watched.filter((w) => w.backfilledAt && w.historyFrom && w.historyFrom.getTime() <= weekAgo).map((w) => w.address),
    );

    for (const rule of transferRules) {
      const scope = await ruleScope(rule, watched);
      const params = parseParams(rule.type as AlertTypeName, rule.params) as { minAmount: number };
      const hits = transfers.filter(
        (t) => Number(t.amount) >= params.minAmount && (scope.has(t.fromAddress) || scope.has(t.toAddress)),
      );

      if (rule.type === "WHALE") {
        for (const t of hits) {
          const info = toInfo(t);
          pending.push({
            rule,
            dedupeKey: `tx:${t.txHash}:${t.fromAddress}:${t.toAddress}`,
            title: `${Math.round(info.amount).toLocaleString("ru-RU")} USDT`,
            message: whaleMessage(info, labels, rule.name, ctx),
            digestLine: digestLine(info, labels, ctx),
          });
        }
      } else {
        // Контрагент — сторона вне области правила; «новый» — не встречался ни в одном более раннем переводе
        const candidates = hits
          .filter((t) => historyReady.has(scope.has(t.toAddress) ? t.toAddress : t.fromAddress))
          .map((t) => ({ t, cp: scope.has(t.toAddress) ? t.fromAddress : t.toAddress }))
          .filter(({ t, cp }) => !(scope.has(t.fromAddress) && scope.has(t.toAddress)) && !labels.has(cp));
        if (!candidates.length) continue;
        const known = new Set(
          (
            await prisma.$queryRaw<{ cp: string }[]>`
              SELECT c.cp FROM unnest(${candidates.map((c) => c.cp)}::text[], ${candidates.map((c) => c.t.blockTimestamp)}::timestamptz[]) AS c(cp, ts)
              WHERE EXISTS (
                SELECT 1 FROM "Transfer" x WHERE x."fromAddress" = c.cp AND x."blockTimestamp" < c.ts
              ) OR EXISTS (
                SELECT 1 FROM "Transfer" x WHERE x."toAddress" = c.cp AND x."blockTimestamp" < c.ts
              )`
          ).map((r) => r.cp),
        );
        const seen = new Set<string>();
        for (const { t, cp } of candidates) {
          if (known.has(cp) || seen.has(cp)) continue;
          seen.add(cp);
          const info = toInfo(t);
          pending.push({
            rule,
            dedupeKey: `cp:${cp}`,
            title: `Новый адрес ${cp.slice(0, 6)}…${cp.slice(-4)}`,
            message: newCounterpartyMessage(info, cp, labels, rule.name, ctx),
            digestLine: `новый ${cp.slice(0, 6)}…${cp.slice(-4)}: ${digestLine(info, labels, ctx)}`,
          });
        }
      }
    }
    const last = transfers.length === 5000 ? transfers[transfers.length - 1].id : maxId;
    await setState(TRANSFER_CURSOR, String(last));
  }

  // --- 2. Всплески объёма --------------------------------------------------------
  for (const rule of rules.filter((r) => r.type === "VOLUME_SPIKE")) {
    const p = parseParams("VOLUME_SPIKE", rule.params) as RuleParams<"VOLUME_SPIKE">;
    const recent = await prisma.alertEvent.findFirst({
      where: { ruleId: rule.id, createdAt: { gt: new Date(now.getTime() - rule.cooldownMin * 60_000) } },
    });
    if (recent) continue;
    const scope = [...(await ruleScope(rule, watched))];
    if (!scope.length) continue;
    const spike = await measureSpike(scope, p, now);
    if (!spike) continue;
    const bucket = Math.floor(now.getTime() / (Math.max(rule.cooldownMin, p.windowMin) * 60_000));
    pending.push({
      rule,
      dedupeKey: `spike:${bucket}`,
      title: `Всплеск ×${(spike.current / spike.baseline).toFixed(1)}`,
      message: spikeMessage(
        { ...spike, windowMin: p.windowMin, topWallets: spike.top.map((t) => ({ label: labels.get(t.address) ?? t.address, volume: t.volume })) },
        rule.name,
        ctx,
      ),
    });
  }

  // --- 3. Паттерны -----------------------------------------------------------------
  const patternRules = rules.filter((r) => r.type === "PATTERN");
  const patternCursor = await getState(PATTERN_CURSOR);
  if (patternCursor === null) {
    await setState(PATTERN_CURSOR, now.toISOString());
  } else if (patternRules.length) {
    const findings = await prisma.patternFinding.findMany({
      where: { firstSeen: { gt: new Date(patternCursor) }, status: "NEW" },
      orderBy: { score: "desc" },
    });
    for (const rule of patternRules) {
      const p = parseParams("PATTERN", rule.params) as RuleParams<"PATTERN">;
      const explicit = rule.addresses.length || rule.categories.length ? await ruleScope(rule, watched) : null;
      for (const f of findings) {
        if (!p.patternTypes.includes(f.type) || f.score < p.minScore) continue;
        if (explicit && !f.addresses.some((a) => explicit.has(a))) continue;
        pending.push({
          rule,
          dedupeKey: `finding:${f.id}`,
          title: f.summary.slice(0, 190),
          message: patternMessage(f, labels, rule.name, ctx),
          digestLine: `${labels.get(f.address) ?? f.address.slice(0, 8) + "…"}: ${f.summary}`,
        });
      }
    }
    await setState(PATTERN_CURSOR, now.toISOString());
  }

  return deliver(pending, opts.send);
}

function toInfo(t: { txHash: string; fromAddress: string; toAddress: string; amount: unknown; blockTimestamp: Date }): TransferInfo {
  return { txHash: t.txHash, from: t.fromAddress, to: t.toAddress, amount: Number(t.amount), ts: t.blockTimestamp };
}

/** Объём окна против средней нормы; null — всплеска нет или истории мало для нормы. */
export async function measureSpike(scope: string[], p: RuleParams<"VOLUME_SPIKE">, now: Date) {
  const windowStart = new Date(now.getTime() - p.windowMin * 60_000);
  const baseStart = new Date(now.getTime() - p.baselineDays * 86_400_000);
  const [row] = await prisma.$queryRaw<{ current: number; n: number; first: Date | null }[]>`
    SELECT coalesce(sum(amount) FILTER (WHERE "blockTimestamp" >= ${windowStart}), 0)::float8 AS current,
           count(*) FILTER (WHERE "blockTimestamp" >= ${windowStart})::int AS n,
           min("blockTimestamp") AS first
    FROM "Transfer"
    WHERE "blockTimestamp" >= ${baseStart} AND "blockTimestamp" <= ${now}
      AND ("fromAddress" = ANY(${scope}::text[]) OR "toAddress" = ANY(${scope}::text[]))`;
  if (!row?.first) return null;
  // Норма — только за время, где история всех кошельков области полная; меньше суток — рано судить
  const history = await prisma.wallet.findMany({ where: { address: { in: scope } }, select: { historyFrom: true } });
  const complete = history.length && history.every((w) => w.historyFrom)
    ? Math.max(...history.map((w) => w.historyFrom!.getTime()))
    : Infinity;
  const coveredFrom = Math.max(baseStart.getTime(), new Date(row.first).getTime(), complete);
  const coveredMs = windowStart.getTime() - coveredFrom;
  if (coveredMs < 86_400_000) return null;
  const [{ base }] = await prisma.$queryRaw<{ base: number }[]>`
    SELECT coalesce(sum(amount), 0)::float8 AS base FROM "Transfer"
    WHERE "blockTimestamp" >= ${new Date(coveredFrom)} AND "blockTimestamp" < ${windowStart}
      AND ("fromAddress" = ANY(${scope}::text[]) OR "toAddress" = ANY(${scope}::text[]))`;
  const baseline = (base / coveredMs) * p.windowMin * 60_000;
  if (row.current < p.minVolume || baseline <= 0 || row.current < baseline * (1 + p.spikePct / 100)) return null;

  const top = await prisma.$queryRaw<{ address: string; volume: number }[]>`
    SELECT a AS address, sum(amount)::float8 AS volume FROM (
      SELECT "fromAddress" AS a, amount FROM "Transfer" WHERE "blockTimestamp" >= ${windowStart} AND "fromAddress" = ANY(${scope}::text[])
      UNION ALL
      SELECT "toAddress", amount FROM "Transfer" WHERE "blockTimestamp" >= ${windowStart} AND "toAddress" = ANY(${scope}::text[])
    ) x GROUP BY a ORDER BY 2 DESC LIMIT 3`;
  return { current: row.current, baseline, count: row.n, top };
}

const ICON: Record<string, string> = { WHALE: "🐋", NEW_COUNTERPARTY: "🆕", VOLUME_SPIKE: "📈", PATTERN: "🔍" };

/** Сохраняет события (без дублей) и отправляет: по одному сообщению или сводкой. */
async function deliver(pending: PendingEvent[], send?: Sender): Promise<AlertRunResult> {
  const result: AlertRunResult = { events: 0, sent: 0, failed: 0, skipped: 0 };
  if (!pending.length) return result;
  const canSend = send ?? (telegramToken() && (await telegramChatId()) ? (html: string) => sendTelegram(html) : null);

  const byRule = new Map<number, PendingEvent[]>();
  for (const ev of pending) (byRule.get(ev.rule.id) ?? byRule.set(ev.rule.id, []).get(ev.rule.id)!).push(ev);

  for (const events of byRule.values()) {
    // Сначала фиксируем событие — если оно уже было, пропускаем (защита от повторов)
    const fresh: { id: bigint; ev: PendingEvent }[] = [];
    for (const ev of events) {
      const created = await prisma.alertEvent
        .create({
          data: {
            ruleId: ev.rule.id,
            dedupeKey: ev.dedupeKey,
            title: ev.title,
            message: ev.message,
            status: canSend ? "SENT" : "SKIPPED",
          },
        })
        .catch((err: { code?: string }) => {
          if (err.code === "P2002") return null; // уже было
          throw err;
        });
      if (created) fresh.push({ id: created.id, ev });
    }
    if (!fresh.length) continue;
    result.events += fresh.length;
    if (!canSend) {
      result.skipped += fresh.length;
      continue;
    }

    const rule = fresh[0].ev.rule;
    const messages =
      fresh.length > DIGEST_THRESHOLD && fresh.every((f) => f.ev.digestLine)
        ? [{ ids: fresh.map((f) => f.id), html: digestMessage(rule.name, ICON[rule.type], fresh.map((f) => f.ev.digestLine!), fresh.length) }]
        : fresh.map((f) => ({ ids: [f.id], html: f.ev.message }));

    for (const m of messages) {
      try {
        await canSend(m.html);
        result.sent += m.ids.length;
      } catch (err) {
        result.failed += m.ids.length;
        await prisma.alertEvent.updateMany({
          where: { id: { in: m.ids } },
          data: { status: "FAILED", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
        });
      }
    }
  }
  return result;
}
