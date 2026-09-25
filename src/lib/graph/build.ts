/**
 * Массив переводов -> граф (узлы-кошельки, агрегированные рёбра), с фильтрами
 * по сумме, датам и глубине связей от seed-адресов. Работает и в браузере, и на сервере.
 */
import { DEFAULT_PATTERN_CONFIG, detectPatterns, type PatternConfig } from "./patterns";
import { DEFAULT_DETECT_CONFIG, scanPatterns, type DetectConfig } from "../patterns/detect";
import type { FlowGraphData, FlowTransfer, GraphEdge, GraphNode, WalletMeta } from "./types";

export interface BuildOptions {
  /** переводы меньше этой суммы отбрасываются до агрегации */
  minAmount?: number;
  fromTs?: number;
  toTs?: number;
  /** стартовые адреса для фильтра глубины; по умолчанию — все отслеживаемые из wallets */
  seeds?: string[];
  /** 1 — прямые контрагенты seed-ов, 2 — контрагенты контрагентов, Infinity — всё */
  depth?: number;
  /** рёбра сверх лимита (самые мелкие по сумме) отбрасываются */
  maxEdges?: number;
  patterns?: Partial<PatternConfig>;
  detect?: DetectConfig;
}

export function buildFlowGraph(
  transfers: FlowTransfer[],
  wallets: WalletMeta[] = [],
  opts: BuildOptions = {},
): FlowGraphData {
  const { minAmount = 0, fromTs = -Infinity, toTs = Infinity, depth = 1, maxEdges = 2_000 } = opts;
  const meta = new Map(wallets.map((w) => [w.address, w]));
  const seeds = new Set(opts.seeds ?? wallets.filter((w) => w.isWatched).map((w) => w.address));

  // 1. Агрегация рёбер from->to
  const edgeMap = new Map<string, GraphEdge>();
  for (const t of transfers) {
    if (t.amount < minAmount || t.ts < fromTs || t.ts > toTs || t.from === t.to) continue;
    const id = `${t.from}->${t.to}`;
    const e = edgeMap.get(id);
    if (e) {
      e.total += t.amount;
      e.count++;
      e.firstTs = Math.min(e.firstTs, t.ts);
      e.lastTs = Math.max(e.lastTs, t.ts);
    } else {
      edgeMap.set(id, {
        id,
        source: t.from,
        target: t.to,
        total: t.amount,
        count: 1,
        firstTs: t.ts,
        lastTs: t.ts,
        inCycle: false,
      });
    }
  }
  let edges = [...edgeMap.values()];

  // 2. Фильтр глубины: BFS без учёта направления от seed-узлов
  const dist = new Map<string, number>();
  if (seeds.size) {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
      (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
    }
    const queue = [...seeds].filter((s) => adj.has(s));
    queue.forEach((s) => dist.set(s, 0));
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      const d = dist.get(v)!;
      if (d >= depth) continue; // depth = Infinity: обходим всё, только чтобы узнать расстояния
      for (const w of adj.get(v) ?? []) {
        if (!dist.has(w)) {
          dist.set(w, d + 1);
          queue.push(w);
        }
      }
    }
    if (Number.isFinite(depth)) edges = edges.filter((e) => dist.has(e.source) && dist.has(e.target));
  }

  // 3. Ограничение размера: оставляем крупнейшие потоки
  let truncated = false;
  if (edges.length > maxEdges) {
    edges.sort((a, b) => b.total - a.total);
    edges = edges.slice(0, maxEdges);
    truncated = true;
  }

  // 4. Узлы и их метрики
  const nodes = new Map<string, GraphNode>();
  const node = (id: string): GraphNode => {
    let n = nodes.get(id);
    if (!n) {
      const m = meta.get(id);
      n = {
        id,
        label: m?.label ?? shortAddress(id),
        category: m?.category ?? "UNKNOWN",
        isWatched: m?.isWatched ?? false,
        isSeed: seeds.has(id),
        balance: m?.usdtBalance ?? null,
        inflow: 0,
        outflow: 0,
        inDegree: 0,
        outDegree: 0,
        txCount: 0,
        depth: dist.get(id) ?? -1,
        roles: [],
      };
      nodes.set(id, n);
    }
    return n;
  };
  for (const e of edges) {
    const s = node(e.source);
    const t = node(e.target);
    s.outflow += e.total;
    s.outDegree++;
    s.txCount += e.count;
    t.inflow += e.total;
    t.inDegree++;
    t.txCount += e.count;
  }

  const nodeList = [...nodes.values()];
  detectPatterns(nodeList, edges, { ...DEFAULT_PATTERN_CONFIG, ...opts.patterns });

  // Поведенческие паттерны — по переводам, попавшим в итоговый граф
  const edgeIds = new Set(edges.map((e) => e.id));
  const kept = transfers.filter(
    (t) => t.amount >= minAmount && t.ts >= fromTs && t.ts <= toTs && edgeIds.has(`${t.from}->${t.to}`),
  );
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const cycles: string[][] = [];
  for (const f of scanPatterns(kept, opts.detect ?? DEFAULT_DETECT_CONFIG)) {
    if (f.type === "FAN_OUT") addRole(nodes.get(f.address), "fan_out");
    else if (f.type === "FAN_IN") addRole(nodes.get(f.address), "fan_in");
    else {
      cycles.push(f.addresses);
      for (const hop of f.metrics.hops as { from: string; to: string }[]) {
        addRole(nodes.get(hop.from), "loop");
        const e = edgeById.get(`${hop.from}->${hop.to}`);
        if (e) e.inCycle = true;
      }
    }
  }
  return { nodes: nodeList, edges, cycles, truncated };
}

function addRole(n: GraphNode | undefined, role: GraphNode["roles"][number]) {
  if (n && !n.roles.includes(role)) n.roles.push(role);
}

export function shortAddress(a: string) {
  return `${a.slice(0, 5)}…${a.slice(-4)}`;
}
