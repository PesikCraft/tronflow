/**
 * Ликвидации из публичных WebSocket-потоков Binance и Bybit. Работает в воркере:
 * суммы копятся в памяти и забираются при очередном снимке рынка (take).
 *
 * Binance шлёт не больше одной ликвидации в секунду на монету — в сильную бурю
 * реальная сумма выше показанной. Bybit отдаёт все.
 */
import { assetOfSymbol, type Exchange, type MarketAsset } from "./exchanges";

export interface LiqEvent {
  exchange: Exchange;
  asset: MarketAsset;
  /** чья позиция ликвидирована */
  side: "long" | "short";
  usd: number;
}

export interface LiqTotals {
  longUsd: number;
  shortUsd: number;
  count: number;
}

export interface StreamStatus {
  connected: boolean;
  lastMessageAt: number | null;
  events: number;
  error?: string;
}

/** Binance: сторона ордера. SELL — принудительно закрыт лонг. */
export function parseBinanceLiquidation(raw: unknown): LiqEvent[] {
  const m = raw as { e?: string; o?: { s: string; S: string; z: string; ap: string; p: string } };
  if (m?.e !== "forceOrder" || !m.o) return [];
  const asset = assetOfSymbol(m.o.s);
  const usd = Number(m.o.z) * (Number(m.o.ap) || Number(m.o.p));
  if (!asset || !(usd > 0)) return [];
  return [{ exchange: "binance", asset, side: m.o.S === "SELL" ? "long" : "short", usd }];
}

/** Bybit: сторона позиции. Buy — ликвидирован лонг (так в документации allLiquidation). */
export function parseBybitLiquidations(raw: unknown): LiqEvent[] {
  const m = raw as { topic?: string; data?: { s: string; S: string; v: string; p: string }[] };
  if (!m?.topic?.startsWith("allLiquidation.") || !Array.isArray(m.data)) return [];
  return m.data.flatMap((d) => {
    const asset = assetOfSymbol(d.s);
    const usd = Number(d.v) * Number(d.p);
    return asset && usd > 0 ? [{ exchange: "bybit" as const, asset, side: d.S === "Buy" ? ("long" as const) : ("short" as const), usd }] : [];
  });
}

interface StreamConfig {
  exchange: Exchange;
  url: string;
  subscribe?: string;
  /** сообщение-пинг, если биржа сама не пингует */
  ping?: string;
  /** столько молчания — соединение считаем мёртвым и переподключаемся */
  silenceMs: number;
  parse: (raw: unknown) => LiqEvent[];
}

class Stream {
  readonly status: StreamStatus = { connected: false, lastMessageAt: null, events: 0 };
  private ws?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private retry = 0;
  private stopped = false;

  constructor(
    private readonly cfg: StreamConfig,
    private readonly onEvent: (e: LiqEvent) => void,
  ) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.drop();
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(this.cfg.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status.connected = true;
      this.status.error = undefined;
      this.status.lastMessageAt = Date.now();
      if (this.cfg.subscribe) ws.send(this.cfg.subscribe);
    };
    ws.onmessage = (m) => {
      this.status.lastMessageAt = Date.now();
      let raw: unknown;
      try {
        raw = JSON.parse(String(m.data));
      } catch {
        return;
      }
      for (const e of this.cfg.parse(raw)) {
        this.status.events++;
        this.onEvent(e);
      }
    };
    ws.onerror = (e) => {
      this.status.error = (e as Event & { message?: string }).message || "ошибка соединения";
    };
    ws.onclose = () => this.restart();
    this.heartbeat = setInterval(() => {
      if (this.cfg.ping && ws.readyState === WebSocket.OPEN) ws.send(this.cfg.ping);
      if (this.status.lastMessageAt && Date.now() - this.status.lastMessageAt > this.cfg.silenceMs) {
        this.status.error = "поток молчит, переподключаемся";
        this.restart();
      }
    }, 20_000);
  }

  /** Закрыть текущее соединение, не дожидаясь закрытия «мёртвого» сокета. */
  private drop() {
    clearInterval(this.heartbeat);
    this.status.connected = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = undefined;
    }
  }

  private restart() {
    this.drop();
    if (this.stopped) return;
    const delay = Math.min(60_000, 2_000 * 2 ** this.retry++);
    this.reconnect = setTimeout(() => this.open(), delay);
  }
}

export class LiquidationFeed {
  private readonly totals = new Map<string, LiqTotals>();
  private readonly streams: Record<Exchange, Stream>;

  constructor(assets: readonly MarketAsset[]) {
    const add = (e: LiqEvent) => {
      const key = `${e.exchange}:${e.asset}`;
      const t = this.totals.get(key) ?? { longUsd: 0, shortUsd: 0, count: 0 };
      if (e.side === "long") t.longUsd += e.usd;
      else t.shortUsd += e.usd;
      t.count++;
      this.totals.set(key, t);
    };
    this.streams = {
      // Старый адрес /ws/ соединяется, но ликвидаций не присылает — только /market/ws/
      binance: new Stream({ exchange: "binance", url: "wss://fstream.binance.com/market/ws/!forceOrder@arr", silenceMs: 15 * 60_000, parse: parseBinanceLiquidation }, add),
      bybit: new Stream(
        {
          exchange: "bybit",
          url: "wss://stream.bybit.com/v5/public/linear",
          subscribe: JSON.stringify({ op: "subscribe", args: assets.map((a) => `allLiquidation.${a}USDT`) }),
          ping: JSON.stringify({ op: "ping" }),
          silenceMs: 90_000,
          parse: parseBybitLiquidations,
        },
        add,
      ),
    };
  }

  start() {
    for (const s of Object.values(this.streams)) s.start();
  }

  stop() {
    for (const s of Object.values(this.streams)) s.stop();
  }

  /** Накопленное по монете на бирже — с обнулением. */
  take(exchange: Exchange, asset: MarketAsset): LiqTotals {
    const key = `${exchange}:${asset}`;
    const t = this.totals.get(key) ?? { longUsd: 0, shortUsd: 0, count: 0 };
    this.totals.delete(key);
    return t;
  }

  status(): Record<Exchange, StreamStatus> {
    return { binance: { ...this.streams.binance.status }, bybit: { ...this.streams.bybit.status } };
  }
}
