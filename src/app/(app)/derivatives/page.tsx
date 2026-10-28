import type { Metadata } from "next";
import { ArrowDownRight, ArrowUpRight, Gauge, Minus } from "lucide-react";
import { prisma } from "@/lib/db";
import { EXCHANGE_LABEL, type Exchange } from "@/lib/market/exchanges";
import type { StreamStatus } from "@/lib/market/liquidations";
import { getMarketOverview } from "@/lib/market/read";
import type { AssetMarket } from "@/lib/market/reading";
import { fmtAgo, fmtCompact, fmtNum } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/PageHeader";
import { Sparkline } from "@/components/Sparkline";

export const metadata: Metadata = { title: "Деривативы" };
export const dynamic = "force-dynamic";

// Как на «Ликвидности» и в «Новостях»: к росту — синий (покупки), к падению — оранжевый (продажи)
const TONE = {
  up: { icon: ArrowUpRight, color: "var(--flow-out)" },
  down: { icon: ArrowDownRight, color: "var(--flow-in)" },
  calm: { icon: Minus, color: "var(--muted)" },
} as const;

const usd = (v: number) => `$${fmtCompact(v)}`;
const signed = (v: number | null, digits = 1) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)} %`);
const price = (v: number) => `$${v >= 1000 ? fmtNum(Math.round(v)) : v.toFixed(v >= 1 ? 2 : 4)}`;

function Figure({ label, value, note, children }: { label: string; value: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 py-3 sm:px-4 sm:first:pl-0">
      <div className="text-fg-2 text-xs">{label}</div>
      <div className="num mt-0.5 font-semibold">{value}</div>
      {children}
      {note && <div className="text-muted num mt-0.5 text-xs">{note}</div>}
    </div>
  );
}

function AssetCard({ m }: { m: AssetMarket }) {
  const tone = TONE[m.reading.tone];
  const liq = m.liq24h.long + m.liq24h.short;
  return (
    <section className="card min-w-0 p-5" aria-labelledby={`asset-${m.asset}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`asset-${m.asset}`} className="display text-lg font-semibold">
          {m.asset}
        </h2>
        <div className="num text-sm">
          <span className="font-semibold">{price(m.price)}</span>
          <span className="text-fg-2"> · за сутки {signed(m.change24hPct)}</span>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 font-medium">
        <tone.icon size={16} className="mt-0.5 shrink-0" style={{ color: tone.color }} aria-hidden />
        {m.reading.headline}
      </p>
      {m.reading.notes.length > 0 && (
        <ul className="text-fg-2 mt-1 space-y-0.5 pl-6 text-sm">
          {m.reading.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="border-line mt-4 grid grid-cols-1 border-t sm:grid-cols-3 sm:divide-x sm:divide-(--line)">
        <Figure label="Открытый интерес" value={usd(m.oiUsd)} note={`за час ${signed(m.oiChange1h)}, за сутки ${signed(m.oiChange24h)}`} />
        <Figure label="Финансирование" value={`${(m.funding8h * 100).toFixed(3)} %`} note="за 8 ч, среднее по биржам" />
        <Figure label="Ликвидации за сутки" value={usd(liq)} note={`лонги ${usd(m.liq24h.long)} · шорты ${usd(m.liq24h.short)}`}>
          <div className="bg-surface-2 mt-1.5 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
            {liq > 0 && (
              <>
                <div style={{ width: `${(m.liq24h.long / liq) * 100}%`, background: "var(--flow-in)" }} />
                <div className="ml-auto" style={{ width: `${(m.liq24h.short / liq) * 100}%`, background: "var(--flow-out)" }} />
              </>
            )}
          </div>
        </Figure>
      </div>

      <div className="border-line border-t pt-3">
        <div className="text-fg-2 mb-1 text-xs">Открытый интерес за сутки</div>
        <Sparkline points={m.oiSeries} label={`Открытый интерес ${m.asset} за сутки`} />
      </div>
    </section>
  );
}

export default async function DerivativesPage() {
  const now = Date.now();
  const [markets, state] = await Promise.all([getMarketOverview(now), prisma.syncState.findUnique({ where: { key: "market_status" } })]);
  const status = state
    ? (JSON.parse(state.value) as { at: number; errors: Partial<Record<Exchange, string>>; streams: Record<Exchange, StreamStatus> })
    : null;
  const failed = status ? (Object.entries(status.errors) as [Exchange, string][]) : [];
  const offline = status ? (Object.entries(status.streams) as [Exchange, StreamStatus][]).filter(([, s]) => !s.connected) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Деривативы"
        lead={
          <>
            Бессрочные фьючерсы Binance и Bybit: открытый интерес, ставка финансирования и ликвидации. Снимок раз в 5 минут, ликвидации
            — из потоков бирж в реальном времени. Чтение позиций — простые правила, а не прогноз.{" "}
            {status ? `Обновлено ${fmtAgo(now - status.at)} назад.` : "Снимков ещё не было."}
            {failed.length > 0 && (
              <span className="text-critical" title={failed.map(([e, msg]) => `${EXCHANGE_LABEL[e]}: ${msg}`).join("\n")}>
                {" "}
                Не ответили: {failed.map(([e]) => EXCHANGE_LABEL[e]).join(", ")}.
              </span>
            )}
            {offline.length > 0 && (
              <span className="text-critical" title={offline.map(([e, s]) => `${EXCHANGE_LABEL[e]}: ${s.error ?? "нет соединения"}`).join("\n")}>
                {" "}
                Нет потока ликвидаций: {offline.map(([e]) => EXCHANGE_LABEL[e]).join(", ")}.
              </span>
            )}
          </>
        }
      />

      {markets.length === 0 ? (
        <div className="card text-fg-2 flex flex-col items-start gap-2 p-8 text-sm">
          <Gauge size={18} className="text-muted" aria-hidden />
          Данных пока нет. Первый снимок появится через несколько минут после запуска воркера, изменения за час — ещё через час.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {markets.map((m) => (
            <AssetCard key={m.asset} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
