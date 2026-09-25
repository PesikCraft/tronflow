/**
 * Поведенческие паттерны по сырым переводам (с учётом времени и сумм):
 *
 *  FAN_OUT — «рассылка/выплаты»: адрес за короткое окно отправляет похожие суммы десяткам получателей;
 *  FAN_IN  — «сбор»: сотни мелких переводов от множества отправителей стекаются на один адрес;
 *  LOOP    — «закольцовка»: деньги проходят A→B→C→A по времени, почти не теряя сумму
 *            (накрутка оборота, микширование).
 *
 * Чистые функции: работают и на сервере (скан по БД), и в браузере (подсветка на графе).
 * Результат — подсказка аналитику со score 0..1 и доказательствами, а не вердикт.
 */
import type { FlowTransfer } from "../graph/types";

export type PatternKind = "FAN_OUT" | "FAN_IN" | "LOOP";

export interface LoopHop {
  from: string;
  to: string;
  amount: number;
  ts: number;
  txHash: string;
}

export interface Finding {
  type: PatternKind;
  /** стабильный ключ для дедупликации между сканами */
  key: string;
  /** главный адрес (для кольца — адрес с наименьшим лексикографическим значением) */
  address: string;
  addresses: string[];
  score: number;
  summary: string;
  metrics: Record<string, number | string | LoopHop[]>;
}

export interface DetectConfig {
  fanOut: { minRecipients: number; windowMin: number; maxCv: number };
  fanIn: { minSenders: number; minTransfers: number; smallMax: number };
  loop: { minLen: number; maxLen: number; maxSpanHours: number; minRetention: number; maxLoops: number };
}

export const DEFAULT_DETECT_CONFIG: DetectConfig = {
  // 10+ получателей за час, суммы похожи (коэф. вариации ≤ 35 %; больше 70 % — не рассылка)
  fanOut: { minRecipients: 10, windowMin: 60, maxCv: 0.35 },
  // 20+ отправителей, 30+ переводов, «мелкий» перевод — до 1 000 USDT
  fanIn: { minSenders: 20, minTransfers: 30, smallMax: 1_000 },
  // кольцо из 3–5 адресов за ≤ 72 ч, на каждом шаге дальше уходит ≥ 50 % суммы
  loop: { minLen: 3, maxLen: 5, maxSpanHours: 72, minRetention: 0.5, maxLoops: 300 },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Коэффициент вариации: std / mean. 0 — все суммы одинаковые. */
function cv(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return 0;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
}

const fmt = (v: number) => Math.round(v).toLocaleString("ru-RU");

function groupBy(transfers: FlowTransfer[], key: "from" | "to") {
  const map = new Map<string, FlowTransfer[]>();
  for (const t of transfers) {
    if (t.from === t.to) continue;
    const k = t[key];
    (map.get(k) ?? map.set(k, []).get(k)!).push(t);
  }
  return map;
}

// ---------------------------------------------------------------------------
// FAN_OUT
// ---------------------------------------------------------------------------

export function detectFanOut(transfers: FlowTransfer[], cfg = DEFAULT_DETECT_CONFIG.fanOut): Finding[] {
  const windowMs = cfg.windowMin * 60_000;
  const findings: Finding[] = [];

  for (const [sender, outs] of groupBy(transfers, "from")) {
    if (outs.length < cfg.minRecipients) continue;
    outs.sort((a, b) => a.ts - b.ts);

    // Скользящее окно: максимум разных получателей за windowMin
    const inWindow = new Map<string, number>();
    let best = { distinct: 0, lo: 0, hi: -1 };
    let lo = 0;
    for (let hi = 0; hi < outs.length; hi++) {
      inWindow.set(outs[hi].to, (inWindow.get(outs[hi].to) ?? 0) + 1);
      while (outs[hi].ts - outs[lo].ts > windowMs) {
        const c = inWindow.get(outs[lo].to)! - 1;
        if (c) inWindow.set(outs[lo].to, c);
        else inWindow.delete(outs[lo].to);
        lo++;
      }
      if (inWindow.size > best.distinct) best = { distinct: inWindow.size, lo, hi };
    }
    if (best.distinct < cfg.minRecipients) continue;

    const burst = outs.slice(best.lo, best.hi + 1);
    const amounts = burst.map((t) => t.amount);
    const variation = cv(amounts);
    const spanMin = (burst[burst.length - 1].ts - burst[0].ts) / 60_000;
    const breadth = clamp01(best.distinct / (3 * cfg.minRecipients));
    const uniformity = variation <= cfg.maxCv ? 1 : clamp01(1 - (variation - cfg.maxCv) / cfg.maxCv);
    // Суммы совсем разные (разброс > 2 × maxCv) — это выплаты биржи клиентам, а не рассылка:
    // такой адрес и так виден на графе как раздающий хаб.
    if (uniformity === 0) continue;
    const score = clamp01(0.3 + 0.2 * breadth + 0.5 * uniformity);
    const total = amounts.reduce((a, b) => a + b, 0);

    findings.push({
      type: "FAN_OUT",
      key: `FAN_OUT:${sender}`,
      address: sender,
      addresses: [sender],
      score: round(score),
      summary: `Разослал ${best.distinct} адресам ${burst.length} переводов по ~${fmt(median(amounts))} USDT (разброс ${Math.round(variation * 100)} %) за ${Math.max(1, Math.round(spanMin))} мин, всего ${fmt(total)} USDT`,
      metrics: {
        recipients: best.distinct,
        transfers: burst.length,
        total: round(total),
        median: round(median(amounts)),
        cv: round(variation, 3),
        spanMin: round(spanMin, 1),
        from: burst[0].ts,
        to: burst[burst.length - 1].ts,
      },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// FAN_IN
// ---------------------------------------------------------------------------

export function detectFanIn(transfers: FlowTransfer[], cfg = DEFAULT_DETECT_CONFIG.fanIn): Finding[] {
  const findings: Finding[] = [];
  const outCount = new Map<string, { n: number; total: number }>();
  for (const t of transfers) {
    const o = outCount.get(t.from) ?? { n: 0, total: 0 };
    o.n++;
    o.total += t.amount;
    outCount.set(t.from, o);
  }

  for (const [receiver, ins] of groupBy(transfers, "to")) {
    if (ins.length < cfg.minTransfers) continue;
    const senders = new Set(ins.map((t) => t.from)).size;
    if (senders < cfg.minSenders) continue;
    const amounts = ins.map((t) => t.amount);
    const med = median(amounts);
    if (med > cfg.smallMax) continue; // крупные входящие — это не «сбор мелочи»

    const smallShare = amounts.filter((a) => a <= cfg.smallMax).length / amounts.length;
    const total = amounts.reduce((a, b) => a + b, 0);
    const out = outCount.get(receiver) ?? { n: 0, total: 0 };
    // Сбор + редкие крупные выводы дальше — классический концентратор
    const sweeps = out.n > 0 && out.n * 5 <= ins.length && out.total >= total * 0.5;
    const score = clamp01(0.4 + 0.3 * clamp01(senders / (5 * cfg.minSenders)) + 0.2 * smallShare + (sweeps ? 0.1 : 0));

    findings.push({
      type: "FAN_IN",
      key: `FAN_IN:${receiver}`,
      address: receiver,
      addresses: [receiver],
      score: round(score),
      summary:
        `Собрал ${ins.length} переводов от ${senders} адресов (медиана ${fmt(med)} USDT), всего ${fmt(total)} USDT` +
        (sweeps ? `; дальше ушло ${out.n} крупными переводами` : ""),
      metrics: {
        senders,
        transfers: ins.length,
        total: round(total),
        median: round(med),
        smallShare: round(smallShare, 3),
        outTransfers: out.n,
        outTotal: round(out.total),
      },
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// LOOP
// ---------------------------------------------------------------------------

/** Ядро графа: итеративно убираем адреса без входящих или без исходящих — они не могут быть в кольце. */
function cyclicCore(transfers: FlowTransfer[]) {
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  for (const t of transfers) {
    if (t.from === t.to) continue;
    (out.get(t.from) ?? out.set(t.from, new Set()).get(t.from)!).add(t.to);
    (inc.get(t.to) ?? inc.set(t.to, new Set()).get(t.to)!).add(t.from);
  }
  const alive = new Set([...out.keys()].filter((v) => inc.has(v)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of alive) {
      const hasOut = [...(out.get(v) ?? [])].some((w) => alive.has(w));
      const hasIn = [...(inc.get(v) ?? [])].some((w) => alive.has(w));
      if (!hasOut || !hasIn) {
        alive.delete(v);
        changed = true;
      }
    }
  }
  return { out, alive };
}

/** Простые направленные циклы длины [min, max] внутри ядра; каждый — один раз (старт с минимального индекса). */
function structuralCycles(transfers: FlowTransfer[], min: number, max: number, limit: number): string[][] {
  const { out, alive } = cyclicCore(transfers);
  const nodes = [...alive].sort();
  const index = new Map(nodes.map((n, i) => [n, i]));
  const cycles: string[][] = [];
  const path: string[] = [];
  const onPath = new Set<string>();

  const dfs = (start: number, v: string) => {
    for (const w of out.get(v) ?? []) {
      if (cycles.length >= limit) return;
      const wi = index.get(w);
      if (wi === undefined || wi < start) continue;
      if (wi === start) {
        if (path.length >= min) cycles.push([...path]);
        continue;
      }
      if (onPath.has(w) || path.length >= max) continue;
      path.push(w);
      onPath.add(w);
      dfs(start, w);
      path.pop();
      onPath.delete(w);
    }
  };
  nodes.forEach((n, i) => {
    path.push(n);
    onPath.add(n);
    dfs(i, n);
    path.pop();
    onPath.delete(n);
  });
  return cycles;
}

export function detectLoops(transfers: FlowTransfer[], cfg = DEFAULT_DETECT_CONFIG.loop): Finding[] {
  const cycles = structuralCycles(transfers, cfg.minLen, cfg.maxLen, cfg.maxLoops);
  if (!cycles.length) return [];

  const byEdge = new Map<string, FlowTransfer[]>();
  for (const t of transfers) {
    const k = `${t.from}>${t.to}`;
    (byEdge.get(k) ?? byEdge.set(k, []).get(k)!).push(t);
  }
  for (const list of byEdge.values()) list.sort((a, b) => a.ts - b.ts);
  const maxSpan = cfg.maxSpanHours * 3_600_000;
  const findings: Finding[] = [];

  for (const cycle of cycles) {
    let best: LoopHop[] | null = null;
    let bestScore = -1;
    // Кольцо могло «начаться» в любом из узлов — пробуем все повороты
    for (let r = 0; r < cycle.length; r++) {
      const nodes = [...cycle.slice(r), ...cycle.slice(0, r)];
      const hops = findTimedChain(nodes, byEdge, maxSpan, cfg.minRetention);
      if (!hops) continue;
      const retention = hops[hops.length - 1].amount / hops[0].amount;
      const span = hops[hops.length - 1].ts - hops[0].ts;
      const s = clamp01(0.5 + 0.25 * clamp01(retention) + 0.25 * (1 - span / maxSpan));
      if (s > bestScore) {
        bestScore = s;
        best = hops;
      }
    }
    if (!best) continue;

    const members = [...cycle].sort();
    const span = best[best.length - 1].ts - best[0].ts;
    const retention = best[best.length - 1].amount / best[0].amount;
    findings.push({
      type: "LOOP",
      key: `LOOP:${members.join(",")}`,
      address: members[0],
      addresses: best.map((h) => h.from),
      score: round(bestScore),
      summary: `Кольцо из ${cycle.length} адресов: ${fmt(best[0].amount)} USDT вернулись к отправителю (${Math.round(retention * 100)} %) за ${span < 3_600_000 ? `${Math.max(1, Math.round(span / 60_000))} мин` : `${round(span / 3_600_000, 1)} ч`}`,
      metrics: {
        length: cycle.length,
        startAmount: round(best[0].amount),
        endAmount: round(best[best.length - 1].amount),
        retention: round(retention, 3),
        spanHours: round(span / 3_600_000, 2),
        hops: best,
      },
    });
  }
  return findings;
}

/**
 * Ищет цепочку реальных переводов по узлам кольца: каждый следующий перевод — не раньше
 * предыдущего, несёт ≥ minRetention его суммы, вся цепочка укладывается в maxSpan.
 */
function findTimedChain(
  nodes: string[],
  byEdge: Map<string, FlowTransfer[]>,
  maxSpan: number,
  minRetention: number,
): LoopHop[] | null {
  const edges = nodes.map((n, i) => byEdge.get(`${n}>${nodes[(i + 1) % nodes.length]}`) ?? []);
  if (edges.some((e) => !e.length)) return null;
  let budget = 5_000; // ограничение перебора на плотных рёбрах

  const walk = (i: number, prev: FlowTransfer | null, start: FlowTransfer | null): FlowTransfer[] | null => {
    if (i === edges.length) return [];
    for (const t of edges[i]) {
      if (--budget < 0) return null;
      if (prev && t.ts < prev.ts) continue;
      if (start && t.ts - start.ts > maxSpan) break; // рёбра отсортированы по времени
      if (prev && t.amount < prev.amount * minRetention) continue;
      if (prev && t.amount > prev.amount * 1.05) continue; // «прибавилось» — это уже другие деньги
      const rest = walk(i + 1, t, start ?? t);
      if (rest) return [t, ...rest];
    }
    return null;
  };

  const chain = walk(0, null, null);
  return chain?.map((t) => ({ from: t.from, to: t.to, amount: t.amount, ts: t.ts, txHash: t.txHash })) ?? null;
}

// ---------------------------------------------------------------------------

export function scanPatterns(transfers: FlowTransfer[], cfg: DetectConfig = DEFAULT_DETECT_CONFIG): Finding[] {
  return [...detectFanOut(transfers, cfg.fanOut), ...detectFanIn(transfers, cfg.fanIn), ...detectLoops(transfers, cfg.loop)].sort(
    (a, b) => b.score - a.score,
  );
}
