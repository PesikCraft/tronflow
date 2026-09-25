import Link from "next/link";
import { Activity, BellOff, Fish, ScanSearch, UserPlus } from "lucide-react";
import { prisma } from "@/lib/db";
import { fmtAgo } from "@/lib/format";

const ICON = { WHALE: Fish, VOLUME_SPIKE: Activity, NEW_COUNTERPARTY: UserPlus, PATTERN: ScanSearch } as const;
const STATUS = { SENT: "", FAILED: "не доставлено", SKIPPED: "только в журнале" } as const;

/** Последние сработавшие сигналы — то же, что уходит в Telegram. */
export async function SignalFeed({ limit = 8 }: { limit?: number }) {
  const [events, newFindings] = await Promise.all([
    prisma.alertEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { rule: { select: { type: true, name: true } } } }),
    prisma.patternFinding.count({ where: { status: "NEW" } }),
  ]);
  return (
    <section className="card flex min-w-0 flex-col" aria-labelledby="signals-h">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 id="signals-h" className="panel-title">
          Последние сигналы
        </h2>
        <Link href="/alerts" className="link text-xs">
          Настроить
        </Link>
      </div>
      {events.length === 0 ? (
        <div className="text-fg-2 flex flex-1 flex-col items-start gap-2 px-5 py-6 text-sm">
          <BellOff size={18} className="text-muted" aria-hidden />
          Сигналов пока не было. Они появятся, когда по кошелькам пройдут крупные переводы или всплески объёма.
        </div>
      ) : (
        <ul className="mt-2 flex-1">
          {events.map((e) => {
            const Icon = ICON[e.rule.type];
            return (
              <li key={String(e.id)} className="border-line flex gap-3 border-t px-5 py-2.5">
                <Icon size={16} className="text-fg-2 mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.title}</div>
                  <div className="text-muted truncate text-xs">
                    {e.rule.name}
                    {STATUS[e.status] && <span className={e.status === "FAILED" ? "text-critical" : ""}>, {STATUS[e.status]}</span>}
                  </div>
                </div>
                <time className="text-muted shrink-0 text-xs" dateTime={e.createdAt.toISOString()}>
                  {fmtAgo(Date.now() - e.createdAt.getTime())}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {newFindings > 0 && (
        <Link href="/patterns" className="border-line hover:bg-surface-2 flex items-center gap-2 border-t px-5 py-3 text-sm">
          <ScanSearch size={16} aria-hidden />
          Новых паттернов для разметки: <b className="num">{newFindings}</b>
        </Link>
      )}
    </section>
  );
}
