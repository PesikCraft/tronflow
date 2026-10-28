import type { Metadata } from "next";
import { ArrowDownRight, ArrowUpRight, Minus, Newspaper } from "lucide-react";
import { prisma } from "@/lib/db";
import { assetLabel, NEWS_ASSETS } from "@/lib/news/classify";
import type { FeedStatus } from "@/lib/news/ingest";
import { NEWS_SOURCES } from "@/lib/news/sources";
import { fmtAgo, fmtDate } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";

export const metadata: Metadata = { title: "Новости" };
export const dynamic = "force-dynamic";

/** С этой важности новость считается важной — фильтр «Важные». */
const IMPORTANT = 6;
const RADAR = ["BTC", "ETH", "XRP", "MARKET"] as const;

// Цвета — как у давления на «Ликвидности»: к росту — покупки (синий), к падению — продажи (оранжевый)
const DIRECTION = {
  BULLISH: { label: "к росту", icon: ArrowUpRight, color: "var(--flow-out)" },
  BEARISH: { label: "к падению", icon: ArrowDownRight, color: "var(--flow-in)" },
  NEUTRAL: { label: "нейтрально", icon: Minus, color: "var(--muted)" },
} as const;

interface Mood {
  asset: string;
  count: number;
  up: number;
  down: number;
  /** суммы важности — так одна новость о ФРС весит больше трёх заметок о курсе */
  upWeight: number;
  downWeight: number;
}

const newsWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "новость" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "новости" : "новостей";

function MoodCell({ m }: { m: Mood }) {
  const total = m.upWeight + m.downWeight;
  const verdict = !m.count
    ? "новостей нет"
    : m.upWeight > m.downWeight * 1.5
      ? "больше к росту"
      : m.downWeight > m.upWeight * 1.5
        ? "больше к падению"
        : "без перевеса";
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-fg-2 text-xs">{assetLabel(m.asset)}</div>
      <div className="mt-1 font-semibold">{verdict}</div>
      <div className="bg-surface-2 mt-2 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
        {total > 0 && (
          <>
            <div style={{ width: `${(m.upWeight / total) * 100}%`, background: "var(--flow-out)" }} />
            <div className="ml-auto" style={{ width: `${(m.downWeight / total) * 100}%`, background: "var(--flow-in)" }} />
          </>
        )}
      </div>
      <div className="text-muted num mt-1.5 text-xs">
        {m.count ? `${m.count} ${newsWord(m.count)}: к росту ${m.up}, к падению ${m.down}` : "за сутки"}
      </div>
    </div>
  );
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ asset?: string; important?: string }> }) {
  const sp = await searchParams;
  const asset = (NEWS_ASSETS as readonly string[]).includes(sp.asset ?? "") ? sp.asset! : null;
  const important = sp.important === "1";
  const now = Date.now();

  const [items, day, state] = await Promise.all([
    prisma.newsItem.findMany({
      where: {
        publishedAt: { gte: new Date(now - 7 * 86_400_000) },
        ...(asset ? { assets: { has: asset } } : {}),
        ...(important ? { impact: { gte: IMPORTANT } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 150,
    }),
    prisma.newsItem.findMany({
      where: { publishedAt: { gte: new Date(now - 86_400_000) } },
      select: { assets: true, sentiment: true, impact: true },
    }),
    prisma.syncState.findUnique({ where: { key: "news_status" } }),
  ]);

  const moods: Mood[] = RADAR.map((a) => {
    const rows = day.filter((d) => d.assets.includes(a));
    const up = rows.filter((r) => r.sentiment === "BULLISH");
    const down = rows.filter((r) => r.sentiment === "BEARISH");
    const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.impact, 0);
    return { asset: a, count: rows.length, up: up.length, down: down.length, upWeight: sum(up), downWeight: sum(down) };
  });

  const status = state ? (JSON.parse(state.value) as { at: number; feeds: FeedStatus[] }) : null;
  const failed = status?.feeds.filter((f) => !f.ok) ?? [];
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(asset ? { asset } : {}), ...(important ? { important: "1" } : {}) });
    for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
    const s = p.toString();
    return s ? `/news?${s}` : "/news";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Новости"
        lead={
          <>
            Каждые 5 минут воркер читает {NEWS_SOURCES.length} лент, включая ФРС и SEC, и по словам заголовка оценивает направление и
            важность. Это подсказка, а не прогноз цены.{" "}
            {status ? `Обновлено ${fmtAgo(now - status.at)} назад.` : "Ленты ещё не читались."}
            {failed.length > 0 && (
              <span className="text-critical" title={failed.map((f) => `${f.name}: ${f.error}`).join("\n")}>
                {" "}
                Не ответили: {failed.map((f) => f.name).join(", ")}.
              </span>
            )}
          </>
        }
      />

      <section className="card grid grid-cols-2 divide-(--line) lg:grid-cols-4 lg:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-(--line) lg:[&>*:nth-child(n+3)]:border-t-0" aria-label="Настрой новостей за сутки">
        {moods.map((m) => (
          <MoodCell key={m.asset} m={m} />
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Монета"
          current={asset ?? "ALL"}
          items={[{ key: "ALL", label: "Все" }, ...NEWS_ASSETS.map((a) => ({ key: a, label: assetLabel(a) }))]}
          href={(k) => q({ asset: k === "ALL" ? null : k })}
        />
        <Segmented
          label="Важность"
          current={important ? "1" : "0"}
          items={[
            { key: "0", label: "Все" },
            { key: "1", label: `Важные, от ${IMPORTANT}` },
          ]}
          href={(k) => q({ important: k === "1" ? "1" : null })}
        />
      </div>

      {items.length === 0 ? (
        <div className="card text-fg-2 flex flex-col items-start gap-2 p-8 text-sm">
          <Newspaper size={18} className="text-muted" aria-hidden />
          {status ? "По этому фильтру за 7 дней новостей нет." : "Новостей пока нет. Первые появятся через несколько минут после запуска воркера."}
        </div>
      ) : (
        <ul className="card">
          {items.map((n, i) => {
            const d = DIRECTION[n.sentiment];
            return (
              <li key={n.id} className={`px-5 py-3.5 ${i ? "border-line border-t" : ""}`}>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {n.title}
                </a>
                <div className="text-fg-2 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <d.icon size={14} style={{ color: d.color }} aria-hidden />
                    {d.label}
                  </span>
                  <span className={`num ${n.impact >= IMPORTANT ? "text-fg font-medium" : ""}`}>важность {n.impact}/10</span>
                  {n.assets.length > 0 && <span>{n.assets.map(assetLabel).join(", ")}</span>}
                  <span className="text-muted">
                    {n.sources.join(", ")} ·{" "}
                    <time dateTime={n.publishedAt.toISOString()} title={fmtDate(n.publishedAt)}>
                      {fmtAgo(now - n.publishedAt.getTime())} назад
                    </time>
                  </span>
                </div>
                {n.reasons.length > 0 && <div className="text-muted mt-0.5 text-xs">{n.reasons.join(", ")}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
