import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { RulesManager } from "@/components/RulesManager";
import { TelegramPanel } from "@/components/TelegramPanel";

export const metadata: Metadata = { title: "Уведомления" };
export const dynamic = "force-dynamic";

const STATUS = {
  SENT: { text: "доставлено", cls: "text-fg-2" },
  FAILED: { text: "не доставлено", cls: "text-critical" },
  SKIPPED: { text: "только журнал", cls: "text-muted" },
} as const;

/** Текст сообщения без HTML-разметки Telegram — для журнала. */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export default async function AlertsPage() {
  const events = await prisma.alertEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { rule: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Уведомления"
        lead="Крупные переводы, всплески объёма, новые адреса и найденные паттерны приходят в Telegram через минуту-две после блока."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <TelegramPanel />
        <RulesManager />
      </div>

      <section className="card" aria-labelledby="log-h">
        <h2 id="log-h" className="panel-title px-5 pt-5">
          Журнал
        </h2>
        {events.length === 0 ? (
          <p className="text-fg-2 px-5 py-6 text-sm">Пока ни одно правило не сработало.</p>
        ) : (
          <ul className="mt-2">
            {events.map((e) => (
              <li key={String(e.id)} className="border-line grid gap-x-6 gap-y-1 border-t px-5 py-3 md:grid-cols-[9rem_minmax(0,1fr)_8rem]">
                <time className="text-fg-2 num text-xs" dateTime={e.createdAt.toISOString()}>
                  {fmtDate(e.createdAt)}
                </time>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{e.title}</div>
                  <p className="text-fg-2 mt-0.5 line-clamp-2 text-xs whitespace-pre-line">{plain(e.message)}</p>
                  {e.error && <p className="text-critical mt-0.5 text-xs">{e.error}</p>}
                </div>
                <div className="text-xs md:text-right">
                  <span className={STATUS[e.status].cls}>{STATUS[e.status].text}</span>
                  <div className="text-muted truncate">{e.rule.name}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
