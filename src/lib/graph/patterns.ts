/**
 * Эвристики структур в графе потоков. Работают по агрегированным рёбрам
 * (from->to, сумма, количество), без знания «правды» — это подсветка для
 * аналитика, а не вердикт.
 */
import type { GraphEdge, GraphNode, NodeRole } from "./types";

export interface PatternConfig {
  /** уникальных контрагентов для статуса collector/distributor */
  hubDegree: number;
  /** получателей у splitter */
  splitFanOut: number;
  /** максимум источников у splitter */
  splitMaxSources: number;
  /** доля входа, ушедшая дальше, для splitter/transit */
  passThroughRatio: number;
  /** transit: |in − out| / max(in, out) не больше этого */
  transitTolerance: number;
  /** transit: минимальный оборот, чтобы не подсвечивать копейки */
  transitMinVolume: number;
}

export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  hubDegree: 8,
  splitFanOut: 5,
  splitMaxSources: 2,
  passThroughRatio: 0.8,
  transitTolerance: 0.1,
  transitMinVolume: 1_000,
};

/**
 * Структурные роли по агрегированным рёбрам. Поведенческие паттерны с учётом времени
 * (рассылка, сбор, кольца) — в lib/patterns/detect.ts, их добавляет buildFlowGraph.
 */
export function detectPatterns(nodes: GraphNode[], edges: GraphEdge[], cfg: PatternConfig = DEFAULT_PATTERN_CONFIG) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  for (const e of edges) {
    (outAdj.get(e.source) ?? outAdj.set(e.source, []).get(e.source)!).push(e.target);
    (inAdj.get(e.target) ?? inAdj.set(e.target, []).get(e.target)!).push(e.source);
  }

  const add = (n: GraphNode, r: NodeRole) => {
    if (!n.roles.includes(r)) n.roles.push(r);
  };

  // 1. Концентраторы, раздатчики, расщепители, транзит
  for (const n of nodes) {
    if (n.inDegree >= cfg.hubDegree) add(n, "collector");
    if (n.outDegree >= cfg.hubDegree) add(n, "distributor");

    const passedOn = n.inflow > 0 ? n.outflow / n.inflow : 0;
    if (
      n.inDegree >= 1 &&
      n.inDegree <= cfg.splitMaxSources &&
      n.outDegree >= cfg.splitFanOut &&
      passedOn >= cfg.passThroughRatio
    ) {
      add(n, "splitter");
    }

    const maxFlow = Math.max(n.inflow, n.outflow);
    if (
      n.inDegree >= 1 &&
      n.outDegree >= 1 &&
      maxFlow >= cfg.transitMinVolume &&
      Math.abs(n.inflow - n.outflow) / maxFlow <= cfg.transitTolerance &&
      // если знаем баланс — он должен быть мал относительно оборота
      (n.balance === null || n.balance <= maxFlow * 0.1)
    ) {
      add(n, "transit");
    }
  }

  // 2. Пирамиды: вершина, чьи ≥3 соседа сами являются хабами того же направления.
  for (const n of nodes) {
    const feeders = (inAdj.get(n.id) ?? []).filter((id) => byId.get(id)?.roles.includes("collector"));
    const subs = (outAdj.get(n.id) ?? []).filter((id) => byId.get(id)?.roles.includes("distributor"));
    if (feeders.length >= 3 || subs.length >= 3) add(n, "apex");
  }
  assignTiers(nodes, inAdj, outAdj);

}

/**
 * Уровни для иерархического layout: BFS от вершин пирамид (или крупнейших хабов),
 * коллектор тянет уровни «вниз» по входящим рёбрам, раздатчик — по исходящим.
 */
function assignTiers(nodes: GraphNode[], inAdj: Map<string, string[]>, outAdj: Map<string, string[]>) {
  const roots = nodes.filter((n) => n.roles.includes("apex"));
  const start = roots.length
    ? roots
    : nodes.filter((n) => n.roles.includes("collector") || n.roles.includes("distributor"));
  const queue: GraphNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const r of start) {
    r.tier = 0;
    queue.push(r);
  }
  while (queue.length) {
    const n = queue.shift()!;
    const next = [...(inAdj.get(n.id) ?? []), ...(outAdj.get(n.id) ?? [])];
    for (const id of next) {
      const m = byId.get(id)!;
      if (m.tier === undefined) {
        m.tier = n.tier! + 1;
        queue.push(m);
      }
    }
  }
}
