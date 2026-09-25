"use client";

/**
 * Интерактивный граф движения USDT на Cytoscape.js.
 *
 * Почему Cytoscape: он рассчитан на аналитические графы (тысячи узлов на canvas,
 * направленные рёбра с подписями, селекторы-стили, алгоритмы обхода, force-directed
 * fCoSE и иерархическая раскладка). D3 потребовал бы писать всё это вручную,
 * vis-network слабее в стилизации и производительности на больших графах.
 *
 * Компонент принимает сырой массив переводов; агрегация, фильтры и поиск паттернов —
 * в lib/graph (чистые функции, покрыты тестами).
 */
import cytoscape, { type Core, type ElementDefinition, type LayoutOptions, type StylesheetJson } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Download, ExternalLink, Loader2, Maximize2, Plus, RotateCcw, Share2 } from "lucide-react";
import { buildFlowGraph } from "@/lib/graph/build";
import type { FlowTransfer, GraphEdge, GraphNode, NodeRole, WalletMeta } from "@/lib/graph/types";
import { CATEGORIES, CATEGORY_LABEL, fmtCompact, fmtDate, fmtNum, shortAddr, tronscanUrl } from "@/lib/format";

let fcoseRegistered = false;
function registerExtensions() {
  if (fcoseRegistered) return;
  try {
    cytoscape.use(fcose);
  } catch {
    // уже зарегистрирован (HMR)
  }
  fcoseRegistered = true;
}

/** Форма — вторичный канал к цвету категории (различимо при дальтонизме и в ч/б печати). */
const SHAPE: Record<string, cytoscape.Css.NodeShape> = {
  EXCHANGE: "round-rectangle",
  OTC: "diamond",
  TRADER: "ellipse",
  WHALE: "hexagon",
  SUSPICIOUS: "triangle",
  UNKNOWN: "ellipse",
};

export const ROLE_INFO: Record<NodeRole, { badge: string; title: string; text: string }> = {
  apex: { badge: "APEX", title: "Вершина пирамиды", text: "Собирает средства с нескольких коллекторов (или раздаёт через нескольких раздатчиков) — двухуровневая иерархия." },
  collector: { badge: "HUB▼", title: "Концентратор", text: "Получает средства от многих разных адресов." },
  distributor: { badge: "HUB▲", title: "Раздающий хаб", text: "Отправляет средства многим разным адресам." },
  splitter: { badge: "SPLIT", title: "Расщепитель", text: "1–2 источника → много получателей, почти весь вход ушёл дальше. Типично для дробления сумм." },
  transit: { badge: "TRANSIT", title: "Транзитный кошелёк", text: "Вход ≈ выход, средства не задерживаются, баланс мал относительно оборота." },
  fan_out: { badge: "FAN-OUT", title: "Рассылка", text: "За короткое время отправил похожие суммы десяткам адресов — выплаты или дробление." },
  fan_in: { badge: "FAN-IN", title: "Сбор", text: "Множество мелких переводов от разных адресов стекается сюда." },
  loop: { badge: "LOOP", title: "Участник кольца", text: "Деньги прошли по кругу A→B→C→A и вернулись почти целиком — возможна накрутка оборота или микширование." },
};

interface Theme {
  fg: string;
  fg2: string;
  muted: string;
  surface: string;
  edge: string;
  highlight: string;
  critical: string;
  warning: string;
  serious: string;
  cat: Record<string, string>;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    fg: v("--fg"),
    fg2: v("--fg-2"),
    muted: v("--muted"),
    surface: v("--surface"),
    edge: v("--muted"),
    highlight: v("--fg"),
    critical: v("--critical"),
    warning: v("--warning"),
    serious: v("--serious"),
    cat: Object.fromEntries(CATEGORIES.map((c) => [c, v(`--cat-${c.toLowerCase()}`)])),
  };
}

function stylesheet(t: Theme): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        shape: "data(shape)" as never,
        width: "data(size)",
        height: "data(size)",
        label: "data(display)",
        "font-size": 10,
        color: t.fg,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-wrap": "wrap",
        "text-max-width": "150px",
        "text-outline-color": t.surface,
        "text-outline-width": 2,
        "min-zoomed-font-size": 8, // подписи рядовых узлов скрываются при отдалении — иначе каша
        "border-width": 0,
      },
    },
    { selector: "node.seed", style: { "border-width": 3, "border-color": t.fg, "font-weight": "bold", "font-size": 14, "min-zoomed-font-size": 4 } },
    { selector: "node.p-transit", style: { "border-width": 3, "border-style": "dashed", "border-color": t.fg2 } },
    { selector: "node.p-hub", style: { "border-width": 6, "border-style": "double", "border-color": t.fg2 } },
    { selector: "node.p-splitter", style: { "border-width": 4, "border-style": "solid", "border-color": t.warning } },
    { selector: "node.p-apex", style: { "border-width": 5, "border-style": "solid", "border-color": t.critical } },
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "line-color": t.edge,
        "target-arrow-color": t.edge,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "bezier",
        opacity: 0.8,
        label: "data(display)",
        "font-size": 9,
        color: t.fg2,
        "text-rotation": "autorotate",
        "text-background-color": t.surface,
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 9,
      },
    },
    { selector: "node.suspicious", style: { color: t.critical, "font-weight": "bold" } },
    { selector: "edge.p-cycle", style: { "line-color": t.critical, "target-arrow-color": t.critical, "line-style": "dashed", opacity: 1 } },
    { selector: ".faded", style: { opacity: 0.1 } },
    { selector: "edge.hl", style: { "line-color": t.highlight, "target-arrow-color": t.highlight, opacity: 1, "z-index": 10 } },
    { selector: "node:selected", style: { "overlay-color": t.highlight, "overlay-opacity": 0.2, "overlay-padding": 6 } },
    { selector: "edge:selected", style: { "line-color": t.highlight, "target-arrow-color": t.highlight, opacity: 1 } },
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Filters {
  minAmount: number;
  dateFrom: string;
  dateTo: string;
  depth: number; // 0 = без ограничения
  sizeBy: "volume" | "balance";
  layout: "cluster" | "hierarchy";
  patterns: boolean;
}

export interface FlowGraphProps {
  transfers: FlowTransfer[];
  wallets: WalletMeta[];
  /** стартовые узлы для глубины; по умолчанию — адресная книга */
  seeds?: string[];
  defaultDepth?: number;
  height?: number | string;
  /** двойной клик / кнопка «Раскрыть связи» */
  onExpand?: (address: string) => Promise<void>;
  onAddToBook?: (input: { address: string; label: string; category: string; autoTags: string[] }) => Promise<void>;
  expanding?: string | null;
}

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

export function FlowGraph({ transfers, wallets, seeds, defaultDepth = 1, height = "75vh", onExpand, onAddToBook, expanding }: FlowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<Filters>({
    minAmount: 100,
    dateFrom: "",
    dateTo: "",
    depth: defaultDepth,
    sizeBy: "volume",
    layout: "cluster",
    patterns: true,
  });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const graph = useMemo(
    () =>
      buildFlowGraph(transfers, wallets, {
        minAmount: filters.minAmount,
        fromTs: filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00").getTime() : undefined,
        toTs: filters.dateTo ? new Date(filters.dateTo + "T23:59:59.999").getTime() : undefined,
        seeds,
        depth: filters.depth === 0 ? Infinity : filters.depth,
      }),
    [transfers, wallets, seeds, filters.minAmount, filters.dateFrom, filters.dateTo, filters.depth],
  );
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);

  const elements = useCallback(
    (theme: Theme): ElementDefinition[] => {
      const nodes = graph.nodes.map<ElementDefinition>((n) => {
        const metric = filters.sizeBy === "balance" ? (n.balance ?? 0) : n.inflow + n.outflow;
        const badges = filters.patterns ? n.roles.map((r) => ROLE_INFO[r].badge).join(" ") : "";
        const classes = [n.isSeed && "seed", n.category === "SUSPICIOUS" && "suspicious"];
        if (filters.patterns) {
          if (n.roles.includes("transit")) classes.push("p-transit");
          if (n.roles.includes("collector") || n.roles.includes("distributor")) classes.push("p-hub");
          if (n.roles.includes("splitter")) classes.push("p-splitter");
          if (n.roles.includes("apex")) classes.push("p-apex");
        }
        return {
          group: "nodes",
          data: {
            id: n.id,
            display: `${n.category === "SUSPICIOUS" ? "⚠ " : ""}${n.label}${badges ? `\n${badges}` : ""}`,
            color: theme.cat[n.category] ?? theme.cat.UNKNOWN,
            shape: SHAPE[n.category] ?? "ellipse",
            size: clamp(16 + 11 * Math.log10(1 + metric / 1000), 16, 90),
            tier: n.tier ?? 99,
          },
          classes: classes.filter(Boolean).join(" "),
        };
      });
      const edges = graph.edges.map<ElementDefinition>((e) => ({
        group: "edges",
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          display: `${fmtCompact(e.total)}${e.count > 1 ? ` · ${e.count}×` : ""}`,
          width: clamp(1 + 1.5 * Math.log10(1 + e.total / 1000), 1, 9),
        },
        classes: filters.patterns && e.inCycle ? "p-cycle" : "",
      }));
      return [...nodes, ...edges];
    },
    [graph, filters.sizeBy, filters.patterns],
  );

  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().empty()) return;
    const n = cy.nodes().length;
    let opts: LayoutOptions;
    if (filters.layout === "hierarchy") {
      // Уровни иерархии — концентрическими кольцами: вершины/хабы в центре, их источники дальше.
      // Строчная раскладка (breadthfirst) не выдерживает хабы с сотнями контрагентов на одном уровне.
      const hasTiers = cy.nodes().some((node) => node.data("tier") === 0);
      opts = {
        name: "concentric",
        concentric: (node: cytoscape.NodeSingular) =>
          hasTiers ? 100 - Math.min(node.data("tier") as number, 99) : node.hasClass("seed") ? 2 : 1,
        levelWidth: () => 1,
        minNodeSpacing: 12,
        spacingFactor: 0.9,
        animate: false,
      } as LayoutOptions;
    } else {
      opts = {
        name: "fcose",
        // "draft" — только спектральная фаза: листья звезды (сотни клиентов обменника) слипаются в точку.
        // Нужна полная силовая фаза; на больших графах сокращаем число итераций и отключаем анимацию.
        quality: "default",
        randomize: true,
        animate: n < 400,
        animationDuration: 400,
        numIter: n > 1500 ? 1200 : 2500,
        tile: true,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 110,
        nodeSeparation: 90,
      } as unknown as LayoutOptions;
    }
    cy.layout(opts).run();
  }, [filters.layout]);

  // Инициализация Cytoscape — один раз
  useEffect(() => {
    registerExtensions();
    const cy = cytoscape({
      container: containerRef.current,
      style: stylesheet(readTheme()),
      minZoom: 0.05,
      maxZoom: 4,
    });
    cyRef.current = cy;

    cy.on("mouseover", "node", (evt) => {
      const hood = evt.target.closedNeighborhood();
      cy.elements().not(hood).addClass("faded");
      hood.edges().addClass("hl");
    });
    cy.on("mouseout", "node", () => cy.elements().removeClass("faded hl"));
    cy.on("tap", "node", (evt) => setSelection({ kind: "node", id: evt.target.id() }));
    cy.on("tap", "edge", (evt) => setSelection({ kind: "edge", id: evt.target.id() }));
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelection(null);
    });

    // Смена светлой/тёмной темы ОС — перечитываем токены
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => cy.style(stylesheet(readTheme()));
    mq.addEventListener("change", onTheme);
    return () => {
      mq.removeEventListener("change", onTheme);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Двойной клик — раскрыть узел (обработчик держим актуальным через ref)
  const onExpandRef = useRef(onExpand);
  onExpandRef.current = onExpand;
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const handler = (evt: cytoscape.EventObject) => onExpandRef.current?.(evt.target.id());
    cy.on("dbltap", "node", handler);
    return () => {
      cy.off("dbltap", "node", handler);
    };
  }, []);

  // Данные/фильтры изменились — перестраиваем элементы
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements(readTheme()));
    });
    runLayout();
    setSelection((s) => (s && cy.getElementById(s.id).nonempty() ? s : null));
  }, [elements, runLayout]);

  function exportPng() {
    const cy = cyRef.current;
    if (!cy) return;
    const blob = cy.png({ output: "blob", full: true, scale: 2, bg: readTheme().surface }) as unknown as Blob;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flow-graph-${new Date().toISOString().slice(0, 16).replace(":", "")}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selectedNode = selection?.kind === "node" ? nodeById.get(selection.id) : undefined;
  const selectedEdge = selection?.kind === "edge" ? edgeById.get(selection.id) : undefined;

  return (
    <div className="space-y-3">
      {/* Фильтры — одной строкой над графом */}
      <div className="card flex flex-wrap items-end gap-3 p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">Мин. сумма перевода, USDT</span>
          <input
            type="number"
            min={0}
            step={100}
            className="input w-36"
            value={filters.minAmount}
            onChange={(e) => set("minAmount", Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">С</span>
          <input type="date" className="input" value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">По</span>
          <input type="date" className="input" value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">Глубина связей</span>
          <select className="input" value={filters.depth} onChange={(e) => set("depth", Number(e.target.value))}>
            <option value={1}>1-я степень</option>
            <option value={2}>2-я степень</option>
            <option value={3}>3-я степень</option>
            <option value={0}>Без ограничения</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">Размер узла</span>
          <select className="input" value={filters.sizeBy} onChange={(e) => set("sizeBy", e.target.value as Filters["sizeBy"])}>
            <option value="volume">по обороту</option>
            <option value="balance">по балансу</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">Раскладка</span>
          <select className="input" value={filters.layout} onChange={(e) => set("layout", e.target.value as Filters["layout"])}>
            <option value="cluster">Кластеры (fCoSE)</option>
            <option value="hierarchy">Иерархия (уровни кольцами)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={filters.patterns} onChange={(e) => set("patterns", e.target.checked)} />
          <span>Подсвечивать паттерны</span>
        </label>
        <div className="ml-auto flex gap-1 pb-0.5">
          <button type="button" className="btn px-2" title="Вписать в экран" onClick={() => cyRef.current?.fit(undefined, 30)}>
            <Maximize2 size={14} aria-hidden />
            <span className="sr-only">Вписать</span>
          </button>
          <button type="button" className="btn px-2" title="Пересчитать раскладку" onClick={runLayout}>
            <RotateCcw size={14} aria-hidden />
            <span className="sr-only">Раскладка</span>
          </button>
          <button type="button" className="btn px-2" title="Сохранить PNG" onClick={exportPng}>
            <Download size={14} aria-hidden />
            <span className="sr-only">PNG</span>
          </button>
        </div>
      </div>

      <div className="text-fg-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>Узлов: {graph.nodes.length}</span>
        <span>Связей: {graph.edges.length}</span>
        <span>Колец: {graph.cycles.length}</span>
        <span>Хабов: {graph.nodes.filter((n) => n.roles.includes("collector") || n.roles.includes("distributor")).length}</span>
        <span>Расщепителей: {graph.nodes.filter((n) => n.roles.includes("splitter")).length}</span>
        <span>Транзитных: {graph.nodes.filter((n) => n.roles.includes("transit")).length}</span>
        {graph.truncated && <span className="text-critical">Показаны только крупнейшие потоки — увеличьте мин. сумму или сузьте период</span>}
        {onExpand && <span className="text-muted">Двойной клик по узлу — загрузить его связи</span>}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="card relative overflow-hidden" style={{ height }}>
          {/* Cytoscape переписывает position контейнера — размер задаём явно, не через inset */}
          <div ref={containerRef} className="h-full w-full" aria-label="Граф связей кошельков" role="img" />
          {graph.nodes.length === 0 && (
            <div className="text-muted absolute inset-0 flex items-center justify-center p-6 text-center text-sm">
              Нет переводов под выбранные фильтры. Уменьшите минимальную сумму, расширьте период или глубину.
            </div>
          )}
          {expanding && (
            <div className="card absolute top-3 left-3 flex items-center gap-2 px-3 py-2 text-xs shadow">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Загружаем связи {shortAddr(expanding)}…
            </div>
          )}
        </div>

        <aside className="card space-y-4 overflow-y-auto p-4 text-sm" style={{ maxHeight: height }}>
          {selectedNode ? (
            <NodePanel node={selectedNode} edges={graph.edges} nodeById={nodeById} onExpand={onExpand} onAddToBook={onAddToBook} expanding={expanding} />
          ) : selectedEdge ? (
            <EdgePanel edge={selectedEdge} nodeById={nodeById} />
          ) : (
            <Legend />
          )}
        </aside>
      </div>
    </div>
  );
}

function ShapeIcon({ category }: { category: string }) {
  const fill = `var(--cat-${category.toLowerCase()})`;
  const s = 14;
  const shape =
    SHAPE[category] === "round-rectangle" ? <rect x={1} y={1} width={12} height={12} rx={3} fill={fill} />
    : SHAPE[category] === "diamond" ? <polygon points="7,0 14,7 7,14 0,7" fill={fill} />
    : SHAPE[category] === "hexagon" ? <polygon points="3.5,1 10.5,1 14,7 10.5,13 3.5,13 0,7" fill={fill} />
    : SHAPE[category] === "triangle" ? <polygon points="7,1 13.5,13 0.5,13" fill={fill} />
    : <circle cx={7} cy={7} r={6} fill={fill} />;
  return (
    <svg width={s} height={s} aria-hidden className="shrink-0">
      {shape}
    </svg>
  );
}

function Legend() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-medium">Категории</h3>
        <ul className="space-y-1.5">
          {CATEGORIES.map((c) => (
            <li key={c} className="text-fg-2 flex items-center gap-2 text-xs">
              <ShapeIcon category={c} /> {CATEGORY_LABEL[c]}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-medium">Паттерны</h3>
        <ul className="text-fg-2 space-y-2 text-xs">
          <li><b className="text-fg">Жирная обводка</b>: кошелёк из адресной книги</li>
          <li><b className="text-critical">Красная обводка, APEX</b>: вершина пирамиды</li>
          <li><b className="text-fg">Двойная обводка, HUB▼ / HUB▲</b>: концентратор или раздающий хаб</li>
          <li><b className="text-fg">Жёлтая обводка, SPLIT</b>: расщепитель</li>
          <li><b className="text-fg">Пунктирная обводка, TRANSIT</b>: транзитный</li>
          <li><b className="text-fg">FAN-OUT</b>: рассылка похожих сумм десяткам адресов</li>
          <li><b className="text-fg">FAN-IN</b>: сбор множества мелких переводов</li>
          <li><b className="text-critical">Красное пунктирное ребро, LOOP</b>: деньги прошли по кругу и вернулись</li>
          <li><b className="text-critical">⚠ в подписи</b>: адрес помечен как подозрительный</li>
        </ul>
      </div>
      <p className="text-muted text-xs">
        Размер узла — оборот (или баланс), толщина стрелки — сумма потока, подпись — сумма и число переводов. Эвристики —
        подсказка для анализа, а не вывод.
      </p>
    </div>
  );
}

function NodePanel({
  node,
  edges,
  nodeById,
  onExpand,
  onAddToBook,
  expanding,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  onExpand?: (address: string) => Promise<void>;
  onAddToBook?: FlowGraphProps["onAddToBook"];
  expanding?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(node.roles.includes("apex") ? "SUSPICIOUS" : "UNKNOWN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flows = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <ShapeIcon category={node.category} />
          <h3 className="font-semibold">{node.label}</h3>
        </div>
        <div className="text-muted addr mt-1 text-xs break-all">{node.id}</div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a href={`/wallets/${node.id}`} className="link ">Карточка</a>
          <a href={`/graph?focus=${node.id}`} className="link inline-flex items-center gap-1">
            <Share2 size={12} aria-hidden /> Граф от этого узла
          </a>
          <a href={tronscanUrl(node.id)} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
            Tronscan <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      </div>

      <dl className="num grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-fg-2">Категория</dt>
        <dd>{CATEGORY_LABEL[node.category] ?? node.category}</dd>
        <dt className="text-fg-2">Баланс</dt>
        <dd>{node.balance == null ? "неизвестен" : `${fmtNum(node.balance)} USDT`}</dd>
        <dt className="text-fg-2">Получено</dt>
        <dd>{fmtNum(node.inflow)} USDT</dd>
        <dt className="text-fg-2">Отправлено</dt>
        <dd>{fmtNum(node.outflow)} USDT</dd>
        <dt className="text-fg-2">Отправителей / получателей</dt>
        <dd>
          {node.inDegree} / {node.outDegree}
        </dd>
        <dt className="text-fg-2">Переводов</dt>
        <dd>{node.txCount}</dd>
        <dt className="text-fg-2">Удалённость</dt>
        <dd>{node.depth === 0 ? "стартовый узел" : node.depth < 0 ? "не связан" : `${node.depth} шаг(а)`}</dd>
      </dl>

      {node.roles.length > 0 && (
        <ul className="space-y-2">
          {node.roles.map((r) => (
            <li key={r} className="bg-surface-2 rounded-md p-2 text-xs">
              <b>{ROLE_INFO[r].badge} · {ROLE_INFO[r].title}.</b> <span className="text-fg-2">{ROLE_INFO[r].text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {onExpand && (
          <button type="button" className="btn" disabled={!!expanding} onClick={() => onExpand(node.id)}>
            {expanding === node.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Share2 size={14} aria-hidden />}
            Раскрыть связи
          </button>
        )}
        {onAddToBook && !node.isWatched && !adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> В адресную книгу
          </button>
        )}
      </div>

      {adding && onAddToBook && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await onAddToBook({ address: node.id, label: label || shortAddr(node.id), category, autoTags: node.roles });
              setAdding(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <input className="input w-full" placeholder="Метка" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          <select className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          {node.roles.length > 0 && <p className="text-muted text-xs">Теги паттернов будут добавлены: {node.roles.join(", ")}</p>}
          {error && <p className="text-critical text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>Добавить</button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </form>
      )}

      <div>
        <h4 className="mb-2 text-xs font-medium">Крупнейшие потоки</h4>
        <ul className="space-y-1.5 text-xs">
          {flows.map((e) => {
            const out = e.source === node.id;
            const other = nodeById.get(out ? e.target : e.source);
            return (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="text-muted w-4 shrink-0">{out ? "→" : "←"}</span>
                  <span className="truncate">{other?.label ?? shortAddr(out ? e.target : e.source)}</span>
                </span>
                <span className="num shrink-0">
                  {out ? "−" : "+"}
                  {fmtCompact(e.total)} · {e.count}×
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function EdgePanel({ edge, nodeById }: { edge: GraphEdge; nodeById: Map<string, GraphNode> }) {
  const from = nodeById.get(edge.source);
  const to = nodeById.get(edge.target);
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="truncate">{from?.label}</span>
        <ArrowRight size={14} className="shrink-0" aria-hidden />
        <span className="truncate">{to?.label}</span>
      </h3>
      <dl className="num grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-fg-2">Сумма</dt>
        <dd>{fmtNum(edge.total)} USDT</dd>
        <dt className="text-fg-2">Переводов</dt>
        <dd>{edge.count}</dd>
        <dt className="text-fg-2">Средний перевод</dt>
        <dd>{fmtNum(edge.total / edge.count)} USDT</dd>
        <dt className="text-fg-2">Первый</dt>
        <dd>{fmtDate(edge.firstTs)}</dd>
        <dt className="text-fg-2">Последний</dt>
        <dd>{fmtDate(edge.lastTs)}</dd>
      </dl>
      {edge.inCycle && (
        <p className="bg-surface-2 rounded-md p-2 text-xs">
          <b>LOOP.</b> <span className="text-fg-2">{ROLE_INFO.loop.text}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        <a className="link " href={`/wallets/${edge.source}`}>Отправитель</a>
        <a className="link " href={`/wallets/${edge.target}`}>Получатель</a>
      </div>
    </div>
  );
}
