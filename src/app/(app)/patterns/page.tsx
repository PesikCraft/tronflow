import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Network, Repeat, Share2, Merge } from "lucide-react";
import { prisma } from "@/lib/db";
import { PATTERN_TAG } from "@/lib/patterns/scan";
import type { LoopHop } from "@/lib/patterns/detect";
import { fmtAgo, fmtDate, fmtNum, shortAddr } from "@/lib/format";
import { CategoryBadge } from "@/components/CategoryBadge";
import { PageHeader } from "@/components/PageHeader";
import { FindingActions, ScanButton } from "@/components/PatternActions";
import { Segmented } from "@/components/Segmented";

export const metadata: Metadata = { title: "Паттерны" };
export const dynamic = "force-dynamic";

const TYPE = {
  FAN_OUT: { title: "Рассылка", icon: Share2, hint: "похожие суммы десяткам адресов за короткое время" },
  FAN_IN: { title: "Сбор", icon: Merge, hint: "множество мелких переводов стекается на один адрес" },
  LOOP: { title: "Кольцо", icon: Repeat, hint: "деньги прошли по кругу и вернулись почти целиком" },
} as const;
type TypeKey = keyof typeof TYPE;

function Confidence({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="w-32 shrink-0" title="Насколько ярко выражен паттерн">
      <div className="text-fg-2 flex justify-between text-xs">
        <span>уверенность</span>
        <span className="num text-fg font-semibold">{pct} %</span>
      </div>
      <div className="bg-surface-2 mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--series)" }} />
      </div>
    </div>
  );
}

export default async function PatternsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === "APPLIED" || sp.status === "DISMISSED" ? sp.status : "NEW";
  const type = sp.type && sp.type in TYPE ? (sp.type as TypeKey) : null;

  const [findings, counts, scan] = await Promise.all([
    prisma.patternFinding.findMany({
      where: { status, ...(type ? { type } : {}) },
      orderBy: [{ score: "desc" }, { lastSeen: "desc" }],
      take: 200,
    }),
    prisma.patternFinding.groupBy({ by: ["status"], _count: true }),
    prisma.syncState.findUnique({ where: { key: "pattern_scan" } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const addresses = [...new Set(findings.flatMap((f) => f.addresses))];
  const wallets = new Map(
    (await prisma.wallet.findMany({ where: { address: { in: addresses } }, select: { address: true, label: true, category: true } })).map((w) => [
      w.address,
      w,
    ]),
  );
  const lastScan = scan ? (JSON.parse(scan.value) as { at: number; found: number }) : null;
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ status, ...(type ? { type } : {}) });
    for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
    return `/patterns?${p}`;
  };
  const name = (a: string) => wallets.get(a)?.label ?? shortAddr(a);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Паттерны"
        lead={
          <>
            Воркер раз в час ищет в переводах за 7 дней рассылки, сбор мелочи и кольца. Подтвердите находку, и адреса получат метку в
            адресной книге и на графе.{" "}
            {lastScan ? `Последний скан ${fmtAgo(Date.now() - lastScan.at)} назад.` : "Скан ещё не запускался."}
          </>
        }
      >
        <ScanButton />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Статус"
          current={status}
          items={[
            { key: "NEW", label: `Новые ${count("NEW")}` },
            { key: "APPLIED", label: `С меткой ${count("APPLIED")}` },
            { key: "DISMISSED", label: `Отклонённые ${count("DISMISSED")}` },
          ]}
          href={(k) => q({ status: k })}
        />
        <Segmented
          label="Тип"
          current={type ?? "ALL"}
          items={[{ key: "ALL", label: "Все" }, ...(Object.keys(TYPE) as TypeKey[]).map((k) => ({ key: k, label: TYPE[k].title }))]}
          href={(k) => q({ type: k === "ALL" ? null : k })}
        />
      </div>

      {findings.length === 0 ? (
        <div className="card text-fg-2 p-8 text-sm">
          {status === "NEW"
            ? "Новых находок нет. Скан запускается автоматически раз в час; можно запустить его вручную кнопкой выше."
            : "Здесь пока пусто."}
        </div>
      ) : (
        <ul className="space-y-3">
          {findings.map((f) => {
            const t = TYPE[f.type];
            const m = f.metrics as Record<string, number | LoopHop[]>;
            const w = wallets.get(f.address);
            return (
              <li key={f.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-fg-2 flex items-center gap-2 text-xs">
                      <t.icon size={14} aria-hidden />
                      <span className="text-fg font-medium">{t.title}</span>
                      <span>{t.hint}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link href={`/wallets/${f.address}`} className="text-base font-semibold hover:underline">
                        {f.type === "LOOP" ? `Кольцо из ${f.addresses.length} адресов` : name(f.address)}
                      </Link>
                      {f.type !== "LOOP" && w && <CategoryBadge category={w.category} />}
                    </div>
                  </div>
                  <Confidence score={f.score} />
                </div>

                <p className="text-fg-2 mt-3 max-w-[80ch]">{f.summary}.</p>

                {f.type === "LOOP" && Array.isArray(m.hops) && (
                  <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Путь денег по кольцу">
                    {(m.hops as LoopHop[]).map((h, i) => (
                      <li key={h.txHash + i} className="flex items-center gap-2">
                        <Link href={`/wallets/${h.from}`} className="hover:underline">
                          {name(h.from)}
                        </Link>
                        <span className="text-muted num flex items-center gap-1 text-xs">
                          <ArrowRight size={12} aria-hidden />
                          {fmtNum(h.amount)}
                          <ArrowRight size={12} aria-hidden />
                        </span>
                        {i === (m.hops as LoopHop[]).length - 1 && (
                          <Link href={`/wallets/${h.to}`} className="hover:underline">
                            {name(h.to)}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <FindingActions id={f.id} status={f.status} tag={PATTERN_TAG[f.type]} />
                  <div className="text-muted flex items-center gap-4 text-xs">
                    <span title={`Впервые: ${fmtDate(f.firstSeen)}`}>обновлено {fmtAgo(Date.now() - f.lastSeen.getTime())} назад</span>
                    <Link href={`/graph?focus=${f.address}&period=7d`} className="link inline-flex items-center gap-1">
                      <Network size={12} aria-hidden /> На графе
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
