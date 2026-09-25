import Link from "next/link";
import type { FlowWindow, LiquiditySnapshot } from "@/lib/liquidity";
import { fmtCompact, fmtSignedCompact } from "@/lib/format";

/**
 * Главный прибор: куда давит рынок. Шкала «весы» от сильных покупок USDT (слева)
 * до сильных продаж (справа), нейтральная зона посередине, стрелка — дисбаланс потоков.
 */
const SEGMENTS = [
  { from: -1, to: -0.5, color: "var(--flow-out)", label: "сильные покупки" },
  { from: -0.5, to: -0.3, color: "color-mix(in srgb, var(--flow-out) 70%, var(--surface))" },
  { from: -0.3, to: -0.15, color: "var(--flow-out-soft)" },
  { from: -0.15, to: 0.15, color: "var(--neutral-mid)", label: "баланс" },
  { from: 0.15, to: 0.3, color: "var(--flow-in-soft)" },
  { from: 0.3, to: 0.5, color: "color-mix(in srgb, var(--flow-in) 70%, var(--surface))" },
  { from: 0.5, to: 1, color: "var(--flow-in)", label: "сильные продажи" },
];

const pos = (score: number) => ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100;

function WindowColumn({ w, active, href }: { w: FlowWindow; active: boolean; href: string }) {
  const max = Math.max(w.inflow, w.outflow, 1);
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`group rounded-lg px-3 py-2.5 ${active ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-xs ${active ? "text-fg font-semibold" : "text-fg-2"}`}>{w.hours === 1 ? "1 час" : `${w.hours} ч`}</span>
        {w.intensity !== null && <span className="text-muted num text-xs">×{w.intensity.toFixed(1)} к норме</span>}
      </div>
      <div className="num mt-1 text-lg font-semibold">{fmtSignedCompact(w.net)}</div>
      <div className="mt-2 space-y-1" aria-hidden>
        <div className="h-1.5 rounded-full" style={{ width: `${(w.inflow / max) * 100}%`, background: "var(--flow-in)", minWidth: w.inflow ? 3 : 0 }} />
        <div className="h-1.5 rounded-full" style={{ width: `${(w.outflow / max) * 100}%`, background: "var(--flow-out)", minWidth: w.outflow ? 3 : 0 }} />
      </div>
      <dl className="num mt-1.5 grid grid-cols-2 gap-x-2 text-xs">
        <dt className="text-muted">приток</dt>
        <dt className="text-muted text-right">отток</dt>
        <dd className="text-fg-2">{fmtCompact(w.inflow)}</dd>
        <dd className="text-fg-2 text-right">{fmtCompact(w.outflow)}</dd>
      </dl>
    </Link>
  );
}

export function PressureInstrument({ data, basePath, query = {} }: { data: LiquiditySnapshot; basePath: string; query?: Record<string, string> }) {
  const { pressure, windows, pressureWindow, scope } = data;
  const x = pos(pressure.score);
  const href = (w: number) => `${basePath}?${new URLSearchParams({ ...query, w: String(w) })}`;
  const noData = windows.every((w) => w.gross === 0);

  return (
    <section aria-labelledby="pressure-h" className="card overflow-hidden">
      <div className="grid gap-6 p-5 md:p-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-fg-2 text-xs">
            {scope.kind === "market" ? `Обменники и OTC, ${scope.wallets} кош.` : `Вся адресная книга, ${scope.wallets} кош.`}
            {", "}окно {pressureWindow === 1 ? "1 час" : `${pressureWindow} ч`}
          </p>
          <h2 id="pressure-h" className="display mt-2 text-xl leading-tight font-semibold text-balance md:text-2xl">
            {noData ? "Потоков пока нет" : pressure.headline}
          </h2>
          <p className="text-fg-2 mt-2 max-w-[62ch] text-sm">
            {noData ? "Добавьте кошельки обменников и OTC — после загрузки истории здесь появится оценка давления на курс." : pressure.explanation}
          </p>

          <div className="mt-6" role="img" aria-label={`Индикатор давления: ${pressure.headline}, значение ${pressure.score.toFixed(2)} от −1 до +1`}>
            <div className="relative h-11">
              <div className="absolute inset-x-0 top-4 flex h-3.5 gap-[2px] overflow-hidden rounded-full">
                {SEGMENTS.map((s) => (
                  <div key={s.from} style={{ flexGrow: s.to - s.from, background: s.color }} />
                ))}
              </div>
              {!noData && (
                <div className="absolute top-0 bottom-0 -translate-x-1/2" style={{ left: `${x}%` }}>
                  <div className="bg-fg mx-auto h-full w-[3px] rounded-full" />
                  <div
                    className={`absolute top-[13px] left-1/2 size-5 -translate-x-1/2 rounded-full border-[3px] ${pressure.confident ? "bg-fg" : "bg-surface"}`}
                    style={{ borderColor: "var(--fg)" }}
                  />
                </div>
              )}
            </div>
            <div className="text-muted mt-1 flex justify-between text-xs">
              <span>Покупки USDT</span>
              <span>баланс</span>
              <span>Продажи USDT</span>
            </div>
            {!noData && !pressure.confident && (
              <p className="text-fg-2 mt-2 text-xs">Объём ниже обычного — сигнал слабый, стрелка показана пустой.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 content-start gap-1 xl:border-l xl:border-(--line) xl:pl-5">
          <p className="text-fg-2 col-span-3 px-3 pb-1 text-xs">Чистый поток на рынок, USDT</p>
          {windows.map((w) => (
            <WindowColumn key={w.hours} w={w} active={w.hours === pressureWindow} href={href(w.hours)} />
          ))}
          <div className="text-fg-2 col-span-3 mt-2 flex flex-wrap gap-x-4 gap-y-1 px-3 text-xs">
            <span>
              Скорость обращения за сутки:{" "}
              <b className="text-fg num">{data.velocity.h24 === null ? "—" : `×${data.velocity.h24.toFixed(2)}`}</b>
              {data.velocity.avgDaily7d !== null && <span className="num"> (обычно ×{data.velocity.avgDaily7d.toFixed(2)})</span>}
            </span>
            <span>
              Баланс рынка: <b className="text-fg num">{fmtCompact(scope.totalBalance)} USDT</b>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
