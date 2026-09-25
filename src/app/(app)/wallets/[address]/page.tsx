import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Network, RefreshCw } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  getActivityProfile,
  getBalanceHistory,
  getSummary,
  getTopCounterparties,
  getTransfers,
  parsePeriod,
  periodStart,
} from "@/lib/analytics";
import { isValidTronAddress } from "@/lib/tron/address";
import { fmtCompact, fmtDate, fmtNum, shortAddr, tronscanUrl } from "@/lib/format";
import { BarChart } from "@/components/BarChart";
import { CategoryBadge } from "@/components/CategoryBadge";
import { JobButton } from "@/components/JobButton";
import { LineChart } from "@/components/LineChart";
import { PeriodTabs } from "@/components/PeriodTabs";
import { StatTile } from "@/components/StatTile";
import { TransfersTable } from "@/components/TransfersTable";

export const dynamic = "force-dynamic";

const PAGE = 50;

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ period?: string; page?: string }>;
}) {
  const { address } = await params;
  if (!isValidTronAddress(address)) notFound();
  const sp = await searchParams;
  const period = parsePeriod(sp.period, "30d");
  const page = Math.max(1, Number(sp.page) || 1);

  const wallet = await prisma.wallet.findUnique({
    where: { address },
    include: { labels: { include: { label: true } } },
  });
  const [summary, counterparties, history, hours, transfers] = await Promise.all([
    getSummary(period, [address]),
    getTopCounterparties(address, period),
    getBalanceHistory(address, period),
    getActivityProfile(period, "hour", [address]),
    getTransfers({ address, since: periodStart(period), limit: PAGE + 1, offset: (page - 1) * PAGE }),
  ]);
  const hasNext = transfers.length > PAGE;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="display text-xl font-semibold">{wallet?.label ?? shortAddr(address)}</h1>
            {wallet && <CategoryBadge category={wallet.category} />}
            {wallet && !wallet.isWatched && <span className="text-muted text-xs">не отслеживается (раскрытый контрагент)</span>}
          </div>
          <div className="text-fg-2 addr mt-1 flex items-center gap-2 text-xs">
            {address}
            <a href={tronscanUrl(address)} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
              Tronscan <ExternalLink size={12} aria-hidden />
            </a>
          </div>
          {wallet?.labels.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {wallet.labels.map(({ label }) => (
                <span key={label.id} className="bg-surface-2 text-fg-2 rounded px-1.5 py-0.5 text-xs">{label.name}</span>
              ))}
            </div>
          ) : null}
          {wallet?.notes && <p className="text-fg-2 mt-2 max-w-2xl text-sm">{wallet.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodTabs current={period} basePath={`/wallets/${address}`} />
          <Link className="btn" href={`/graph?focus=${address}&period=${period}`}>
            <Network size={14} aria-hidden /> Граф
          </Link>
          {wallet?.isWatched ? (
            <JobButton url={`/api/wallets/${address}/sync`} title="Догрузить переводы и обновить баланс">
              <RefreshCw size={14} aria-hidden /> Синхронизировать
            </JobButton>
          ) : (
            <JobButton url={`/api/wallets/${address}/expand`} title="Загрузить переводы этого адреса за 30 дней">
              <RefreshCw size={14} aria-hidden /> Загрузить связи
            </JobButton>
          )}
          <a className="btn" href={`/api/export/transfers?address=${address}&period=${period}`}>
            <Download size={14} aria-hidden /> CSV
          </a>
        </div>
      </header>

      {!wallet && (
        <p className="card text-fg-2 p-4 text-sm">
          Адреса нет в базе — показаны только переводы, где он встречается как контрагент. Добавьте его в адресную книгу или нажмите
          «Загрузить связи».
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Баланс USDT"
          value={wallet?.usdtBalance == null ? "—" : fmtNum(Number(wallet.usdtBalance))}
          hint={wallet?.balanceUpdatedAt ? `обновлён ${fmtDate(wallet.balanceUpdatedAt)}` : undefined}
        />
        <StatTile label={`Оборот за ${period}`} value={`${fmtCompact(summary.totalVolume)} USDT`} hint={`${fmtNum(summary.txCount)} переводов`} />
        <StatTile label="Приток / отток" value={`${fmtCompact(summary.inflow)} / ${fmtCompact(summary.outflow)}`} hint={`средний ${fmtCompact(summary.avgSize)} · медиана ${fmtCompact(summary.medianSize)}`} />
        <StatTile
          label="Контрагентов"
          value={fmtNum(summary.uniqueCounterparties)}
          hint={wallet?.historyFrom ? `история с ${fmtDate(wallet.historyFrom, false)}` : undefined}
        />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <LineChart title="История баланса USDT" points={history.map((h) => ({ ts: h.ts, value: h.usdt }))} />
        <BarChart
          title="Пиковые часы (Asia/Yerevan)"
          data={hours.map((b) => ({ label: `${String(b.key).padStart(2, "0")}:00`, tick: Number(b.key) % 3 === 0 ? String(b.key) : "", value: b.volume, count: b.count }))}
        />
      </div>

      <section className="card" aria-labelledby="cp-h">
        <h2 id="cp-h" className="px-4 pt-4 text-sm font-medium">Главные контрагенты за {period}</h2>
        {counterparties.length === 0 ? (
          <p className="text-muted px-4 py-6 text-sm">Нет переводов за период.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num mt-2 w-full text-sm">
              <thead className="text-fg-2 text-left text-xs">
                <tr>
                  <th className="px-4 py-2 font-medium">Контрагент</th>
                  <th className="px-4 py-2 text-right font-medium">Получено от него</th>
                  <th className="px-4 py-2 text-right font-medium">Отправлено ему</th>
                  <th className="px-4 py-2 text-right font-medium">Переводов</th>
                  <th className="px-4 py-2 font-medium">Последний</th>
                </tr>
              </thead>
              <tbody>
                {counterparties.map((c) => (
                  <tr key={c.address} className="border-line border-t">
                    <td className="px-4 py-2">
                      <Link href={`/wallets/${c.address}`} className="hover:underline">
                        {c.label ?? <span className="addr text-xs">{shortAddr(c.address)}</span>}
                      </Link>
                      {c.category && c.category !== "UNKNOWN" && <span className="ml-2"><CategoryBadge category={c.category} /></span>}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtNum(c.inflow)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(c.outflow)}</td>
                    <td className="px-4 py-2 text-right">{c.txCount}</td>
                    <td className="text-fg-2 px-4 py-2 whitespace-nowrap">{fmtDate(c.lastTs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="tx-h">
        <h2 id="tx-h" className="px-4 pt-4 text-sm font-medium">Переводы за {period}</h2>
        <TransfersTable rows={transfers.slice(0, PAGE)} self={address} />
        {(page > 1 || hasNext) && (
          <nav className="border-line flex items-center justify-between border-t px-4 py-3 text-sm" aria-label="Страницы">
            {page > 1 ? (
              <Link className="btn" href={`/wallets/${address}?period=${period}&page=${page - 1}`}>← Новее</Link>
            ) : <span />}
            <span className="text-muted">стр. {page}</span>
            {hasNext ? (
              <Link className="btn" href={`/wallets/${address}?period=${period}&page=${page + 1}`}>Старее →</Link>
            ) : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}
