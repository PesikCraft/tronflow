import Link from "next/link";
import { Download } from "lucide-react";
import {
  getActivityProfile,
  getSummary,
  getSystemStatus,
  getTransfers,
  getVolumeSeries,
  getWalletStats,
  parsePeriod,
} from "@/lib/analytics";
import { getLiquidity } from "@/lib/liquidity";
import { fmtAgo, fmtCompact, fmtDate, fmtNum, fmtSignedCompact } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BarChart } from "@/components/BarChart";
import { CategoryBadge } from "@/components/CategoryBadge";
import { FlowChart } from "@/components/FlowChart";
import { PeriodTabs } from "@/components/PeriodTabs";
import { PressureInstrument } from "@/components/PressureInstrument";
import { SignalFeed } from "@/components/SignalFeed";
import { SystemStatusCard } from "@/components/SystemStatusCard";
import { TransfersTable } from "@/components/TransfersTable";

export const dynamic = "force-dynamic";

const DOW = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const PERIOD_WORD = { "1d": "за сутки", "7d": "за 7 дней", "30d": "за 30 дней", "90d": "за 90 дней" } as const;

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-fg-2 text-xs">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {note && <div className="text-muted mt-0.5 text-xs">{note}</div>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string; w?: string }> }) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const window = Number(sp.w) || 4;
  const [status, liquidity, summary, hours, days, series, wallets, recent] = await Promise.all([
    getSystemStatus(),
    getLiquidity({ window, range: "48h" }),
    getSummary(period),
    getActivityProfile(period, "hour"),
    getActivityProfile(period, "isodow"),
    getVolumeSeries(period),
    getWalletStats(period),
    getTransfers({ limit: 20 }),
  ]);
  const net = summary.inflow - summary.outflow;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-xl font-semibold">Обзор</h1>
        <SystemStatusCard s={status} />
      </div>

      {wallets.length === 0 ? (
        <section className="card p-8">
          <h2 className="display text-lg font-semibold">Начните с адресной книги</h2>
          <p className="text-fg-2 mt-2 max-w-[60ch]">
            Добавьте кошельки обменников, OTC и трейдеров, за которыми следите. Воркер загрузит их историю за 30 дней и дальше
            будет видеть каждый перевод примерно через минуту.
          </p>
          <Link href="/wallets" className="btn-primary mt-5">
            Добавить кошельки
          </Link>
        </section>
      ) : (
        <>
          <PressureInstrument data={liquidity} basePath="/" query={{ period }} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="card min-w-0 p-5" aria-labelledby="flow48-h">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="flow48-h" className="panel-title">
                  Потоки рынка за 48 часов
                </h2>
                <Link href="/liquidity" className="link text-xs">
                  Подробнее о ликвидности
                </Link>
              </div>
              <FlowChart series={liquidity.series} bucketHours={1} height={220} />
            </section>
            <SignalFeed />
          </div>

          <section aria-labelledby="period-h" className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="period-h" className="display text-lg font-semibold">
                Оборот книги {PERIOD_WORD[period]}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <PeriodTabs current={period} basePath="/" extra={{ w: String(window) }} />
                <a className="btn" href={`/api/export/wallets?period=${period}`}>
                  <Download size={14} aria-hidden /> CSV
                </a>
              </div>
            </div>

            <div className="card grid grid-cols-2 divide-(--line) lg:grid-cols-4 lg:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-(--line) lg:[&>*:nth-child(n+3)]:border-t-0">
              <Figure label="Оборот" value={`${fmtCompact(summary.totalVolume)} USDT`} note={`${fmtNum(summary.txCount)} переводов`} />
              <Figure label="Средний перевод" value={`${fmtCompact(summary.avgSize)} USDT`} note={`медиана ${fmtCompact(summary.medianSize)}: устойчивее к китам`} />
              <Figure
                label="Нетто книги"
                value={`${fmtSignedCompact(net)} USDT`}
                note={`приток ${fmtCompact(summary.inflow)}, отток ${fmtCompact(summary.outflow)}`}
              />
              <Figure label="Уникальных контрагентов" value={fmtNum(summary.uniqueCounterparties)} note="адреса вне книги" />
            </div>

            <BarChart
              title={period === "1d" ? "Объём по часам" : "Объём по дням"}
              data={series.map((b, i) => {
                const key = String(b.key);
                const tick = period === "1d" ? key.slice(11, 13) : key.slice(8, 10) + "." + key.slice(5, 7);
                const every = Math.ceil(series.length / 12);
                return { label: period === "1d" ? key.slice(11) : `${key.slice(8, 10)}.${key.slice(5, 7)}`, tick: i % every === 0 ? tick : "", value: b.volume, count: b.count };
              })}
            />

            <div className="grid gap-6 lg:grid-cols-2">
              <BarChart
                title="Пиковые часы по Еревану"
                data={hours.map((b) => ({ label: `${String(b.key).padStart(2, "0")}:00`, tick: Number(b.key) % 3 === 0 ? String(b.key) : "", value: b.volume, count: b.count }))}
              />
              <BarChart
                title="Активность по дням недели"
                data={days.map((b) => ({ label: DOW[Number(b.key)], tick: DOW[Number(b.key)], value: b.volume, count: b.count }))}
              />
            </div>
          </section>

          <section className="card" aria-labelledby="wallets-h">
            <h2 id="wallets-h" className="panel-title px-5 pt-5">
              Кошельки {PERIOD_WORD[period]}
            </h2>
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead className="text-fg-2 text-left text-xs">
                  <tr>
                    <th className="px-5 py-2 font-medium">Кошелёк</th>
                    <th className="px-3 py-2 text-right font-medium">Баланс</th>
                    <th className="px-3 py-2 text-right font-medium">Приток</th>
                    <th className="px-3 py-2 text-right font-medium">Отток</th>
                    <th className="px-3 py-2 text-right font-medium">Переводов</th>
                    <th className="px-3 py-2 text-right font-medium">Контрагентов</th>
                    <th className="px-5 py-2 font-medium">Активность</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map((w) => (
                    <tr key={w.address} className="border-line border-t">
                      <td className="px-5 py-2.5">
                        <Link href={`/wallets/${w.address}`} className="font-medium hover:underline">
                          {w.label}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
                          <CategoryBadge category={w.category} />
                          {!w.backfilledAt && <span className="text-muted text-xs">загружается история</span>}
                          {w.syncError && (
                            <span className="text-critical text-xs" title={w.syncError}>
                              ошибка синхронизации
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">{w.usdtBalance == null ? "—" : fmtNum(w.usdtBalance)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(w.inflow)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(w.outflow)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(w.txCount)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(w.counterparties)}</td>
                      <td className="text-fg-2 px-5 py-2.5 whitespace-nowrap" title={w.lastActivity ? fmtDate(w.lastActivity) : undefined}>
                        {w.lastActivity ? `${fmtAgo(Date.now() - new Date(w.lastActivity).getTime())} назад` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-labelledby="recent-h">
            <div className="flex items-center justify-between px-5 pt-5">
              <h2 id="recent-h" className="panel-title">
                Последние переводы
              </h2>
              <a className="link text-xs" href={`/api/export/transfers?period=${period}`}>
                Выгрузить {PERIOD_WORD[period]} в CSV
              </a>
            </div>
            <TransfersTable rows={recent} />
          </section>
        </>
      )}
    </div>
  );
}
