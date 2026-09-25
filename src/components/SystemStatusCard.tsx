import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { SystemStatus } from "@/lib/analytics";
import { fmtAgo, fmtNum } from "@/lib/format";

/** Состояние воркера и лимитов. Статус — иконкой и текстом, не только цветом. */
export function SystemStatusCard({ s }: { s: SystemStatus }) {
  const now = Date.now();
  const age = s.worker ? now - s.worker.at : Infinity;
  const lag = s.worker?.ingest.lagMs;
  const usagePct = Math.round((s.requestsToday / s.dailyBudget) * 100);
  const dbMb = s.dbSizeBytes / 1_048_576;
  const dbFull = s.dbLimitMb > 0 && dbMb >= s.dbLimitMb * 0.9;
  const state: "ok" | "warn" | "down" =
    age > 5 * 60_000 ? "down" : s.worker?.overBudget || (lag ?? 0) > 10 * 60_000 || s.walletErrors > 0 || dbFull ? "warn" : "ok";
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? AlertTriangle : XCircle;
  const color = state === "ok" ? "var(--good-text)" : state === "warn" ? "var(--serious)" : "var(--critical)";
  const text =
    state === "down"
      ? s.worker
        ? `Воркер не отвечает ${fmtAgo(age)}. Проверьте ./scripts/status.sh`
        : "Воркер ещё не запускался"
      : state === "warn"
        ? "Мониторинг работает с предупреждениями"
        : "Мониторинг работает";

  const facts = [
    s.worker && `последний цикл ${fmtAgo(age)} назад`,
    lag !== undefined ? `отставание от сети ${fmtAgo(lag)}` : s.worker && "первый цикл: догоняет сеть",
    `TronGrid сегодня ${fmtNum(s.requestsToday)} из ${fmtNum(s.dailyBudget)} (${usagePct} %)`,
    s.pendingBackfills > 0 && `загружается история ${s.pendingBackfills} кош.`,
    s.pendingJobs > 0 && `в очереди задач: ${s.pendingJobs}`,
    s.walletErrors > 0 && `ошибки синхронизации у ${s.walletErrors} кош.`,
    s.dbLimitMb > 0
      ? `база ${Math.round(dbMb)} из ${s.dbLimitMb} МБ${dbFull ? ": почти заполнена, сократите срок хранения" : ""}`
      : `база ${Math.round(dbMb)} МБ`,
  ].filter(Boolean) as string[];

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm" aria-label="Состояние системы">
      <span className="flex items-center gap-2 font-medium">
        <Icon size={16} style={{ color }} aria-hidden />
        {text}
      </span>
      {facts.map((f) => (
        <span key={f} className="text-fg-2 text-xs">
          {f}
        </span>
      ))}
      {s.lastError && now - s.lastError.at < 3_600_000 && (
        <span className="text-critical w-full text-xs">
          Ошибка {fmtAgo(now - s.lastError.at)} назад: {s.lastError.message}
        </span>
      )}
    </section>
  );
}
