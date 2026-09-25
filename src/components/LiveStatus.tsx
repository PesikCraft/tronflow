import { prisma } from "@/lib/db";
import { fmtAgo } from "@/lib/format";

/** Индикатор в боковой панели: идёт ли поток данных прямо сейчас. */
export async function LiveStatus() {
  const s = await prisma.syncState.findUnique({ where: { key: "worker_status" } });
  const w = s ? (JSON.parse(s.value) as { at: number; ingest?: { lagMs?: number } }) : null;
  const age = w ? Date.now() - w.at : Infinity;
  const lag = w?.ingest?.lagMs;
  const state = age > 5 * 60_000 ? "down" : (lag ?? 0) > 10 * 60_000 ? "stale" : "live";
  const text =
    state === "down"
      ? w
        ? `Воркер молчит ${fmtAgo(age)}`
        : "Воркер не запускался"
      : state === "stale"
        ? `Догоняем сеть, отставание ${fmtAgo(lag!)}`
        : lag === undefined
          ? "Воркер запущен, догоняет сеть"
          : `Поток идёт, задержка ${fmtAgo(lag)}`;
  return (
    <div className="flex items-center gap-2.5 px-2 text-xs" role="status">
      <span className="live-dot shrink-0" data-state={state} aria-hidden />
      <span className="text-fg-2">{text}</span>
    </div>
  );
}
