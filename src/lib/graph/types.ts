export type WalletCategory = "EXCHANGE" | "OTC" | "TRADER" | "WHALE" | "SUSPICIOUS" | "UNKNOWN";

/** Минимальный перевод, который понимает граф (приходит из /api/graph). */
export interface FlowTransfer {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  /** ms since epoch */
  ts: number;
}

export interface WalletMeta {
  address: string;
  label: string;
  category: WalletCategory | string;
  isWatched: boolean;
  usdtBalance?: number | null;
}

/**
 * Роли узлов, которые проставляют эвристики:
 *  collector   — концентратор: много разных отправителей
 *  distributor — раздающий: много разных получателей
 *  splitter    — «расщепитель»: 1–2 источника -> много получателей, почти всё сразу ушло дальше
 *  transit     — транзитный: вход ≈ выход, деньги не задерживаются
 *  apex        — вершина двухуровневой пирамиды (коллектор коллекторов / раздатчик раздатчиков)
 *  fan_out     — рассылка: похожие суммы десяткам адресов за короткое время
 *  fan_in      — сбор: множество мелких переводов от разных адресов
 *  loop        — участник кольца A→B→C→A, подтверждённого по времени и суммам
 */
export type NodeRole = "collector" | "distributor" | "splitter" | "transit" | "apex" | "fan_out" | "fan_in" | "loop";

export interface GraphNode {
  id: string; // адрес
  label: string;
  category: string;
  isWatched: boolean;
  isSeed: boolean;
  balance: number | null;
  inflow: number;
  outflow: number;
  inDegree: number; // уникальные отправители
  outDegree: number; // уникальные получатели
  txCount: number;
  /** расстояние (в рёбрах, без учёта направления) от ближайшего seed-узла; -1 — не связан с ними */
  depth: number;
  roles: NodeRole[];
  /** уровень в иерархии для layout «пирамида» (0 = вершина) */
  tier?: number;
}

export interface GraphEdge {
  id: string; // from->to
  source: string;
  target: string;
  total: number;
  count: number;
  firstTs: number;
  lastTs: number;
  inCycle: boolean;
}

export interface FlowGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** кольца: адреса по порядку движения денег */
  cycles: string[][];
  truncated: boolean;
}
