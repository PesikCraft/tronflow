import Link from "next/link";
import type { Metadata } from "next";
import { getLiquidity, SERIES_RANGES, type SeriesRange } from "@/lib/liquidity";
import { fmtNum, fmtSigned } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CategoryBadge } from "@/components/CategoryBadge";
import { FlowChart } from "@/components/FlowChart";
import { PageHeader } from "@/components/PageHeader";
import { PressureInstrument } from "@/components/PressureInstrument";
import { Segmented } from "@/components/Segmented";

export const metadata: Metadata = { title: "Ликвидность" };
export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<SeriesRange, string> = { "48h": "48 часов", "7d": "7 дней", "30d": "30 дней" };
const BUCKET_HOURS: Record<SeriesRange, number> = { "48h": 1, "7d": 4, "30d": 24 };

export default async function LiquidityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const range = (sp.range && sp.range in SERIES_RANGES ? sp.range : "48h") as SeriesRange;
  const scope = sp.scope === "all" ? "all" : "market";
  const window = Number(sp.w) || 4;
  const data = await getLiquidity({ scope, window, range });
  const q = (patch: Record<string, string>) => `/liquidity?${new URLSearchParams({ range, scope, w: String(window), ...patch })}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Ликвидность"
        lead="Куда движется USDT у обменников и OTC: чистый приток и отток, давление на курс и скорость обращения денег."
      >
        <Segmented
          label="Чьи потоки"
          current={scope}
          items={[
            { key: "market", label: "Обменники и OTC" },
            { key: "all", label: "Вся книга" },
          ]}
          href={(k) => q({ scope: k })}
        />
      </PageHeader>

      <PressureInstrument data={data} basePath="/liquidity" query={{ range, scope }} />

      <section className="card min-w-0 p-5" aria-labelledby="flows-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="flows-h" className="panel-title">
            Приток и отток по {BUCKET_HOURS[range] === 1 ? "часам" : BUCKET_HOURS[range] === 4 ? "4 часа" : "дням"}
          </h2>
          <Segmented
            label="Диапазон"
            current={range}
            items={(Object.keys(SERIES_RANGES) as SeriesRange[]).map((r) => ({ key: r, label: RANGE_LABEL[r] }))}
            href={(k) => q({ range: k })}
          />
        </div>
        <FlowChart series={data.series} bucketHours={BUCKET_HOURS[range]} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card min-w-0" aria-labelledby="movers-h">
          <h2 id="movers-h" className="panel-title px-5 pt-5">
            Кто двигает рынок за сутки
          </h2>
          {data.movers.length === 0 ? (
            <p className="text-muted px-5 py-6 text-sm">За сутки внешних переводов у кошельков рынка не было.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead className="text-fg-2 text-left text-xs">
                  <tr>
                    <th className="px-5 py-2 font-medium">Кошелёк</th>
                    <th className="px-3 py-2 text-right font-medium">Приток</th>
                    <th className="px-3 py-2 text-right font-medium">Отток</th>
                    <th className="px-5 py-2 text-right font-medium">Нетто</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movers.map((m) => (
                    <tr key={m.address} className="border-line border-t">
                      <td className="px-5 py-2.5">
                        <Link href={`/wallets/${m.address}`} className="font-medium hover:underline">
                          {m.label}
                        </Link>
                        <div className="mt-0.5">
                          <CategoryBadge category={m.category} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(m.inflow)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtNum(m.outflow)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold">{fmtSigned(m.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card min-w-0 p-5 text-sm" aria-labelledby="how-h">
          <h2 id="how-h" className="panel-title">
            Как читать
          </h2>
          <dl className="text-fg-2 mt-3 space-y-3">
            <div>
              <dt className="text-fg font-medium">Приток на рынок</dt>
              <dd>USDT пришли на обменники извне: клиенты сдают USDT за драмы. Предложение растёт — давление продаж.</dd>
            </div>
            <div>
              <dt className="text-fg font-medium">Отток с рынка</dt>
              <dd>USDT ушли с обменников клиентам: спрос на покупку. Предложение сокращается — давление покупок.</dd>
            </div>
            <div>
              <dt className="text-fg font-medium">Переводы между обменниками</dt>
              <dd>Внутренние, на давление не влияют, но входят в скорость обращения.</dd>
            </div>
            <div>
              <dt className="text-fg font-medium">Скорость обращения</dt>
              <dd>Оборот за сутки, делённый на суммарный баланс. ×2 — каждый доллар на балансах обернулся дважды.</dd>
            </div>
            <div>
              <dt className="text-fg font-medium">«×1,4 к норме»</dt>
              <dd>Оборот окна относительно среднего такого же окна за прошлые 7 дней. Ниже ×0,3 сигнал считается слабым.</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
