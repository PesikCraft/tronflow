"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";

async function patch(id: number, action: "apply" | "dismiss" | "reopen") {
  const res = await fetch(`/api/patterns/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export function FindingActions({ id, status, tag }: { id: number; status: string; tag: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "apply" | "dismiss" | "reopen") => {
    setBusy(action);
    setError(null);
    try {
      await patch(id, action);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "NEW" && (
        <>
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run("apply")}>
            {busy === "apply" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            Поставить метку «{tag}»
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => run("dismiss")}>
            <X size={14} aria-hidden /> Отклонить
          </button>
        </>
      )}
      {status !== "NEW" && (
        <button type="button" className="btn" disabled={!!busy} onClick={() => run("reopen")}>
          <RotateCcw size={14} aria-hidden /> Вернуть в новые
        </button>
      )}
      {error && <span className="text-critical text-xs">{error}</span>}
    </div>
  );
}

export function ScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-3">
      {note && <span className="text-fg-2 text-xs">{note}</span>}
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          const res = await fetch("/api/patterns/scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ days: 7 }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setNote(body.error ?? "Скан не удался");
          setNote(`Проверено ${body.scanned.toLocaleString("ru-RU")} переводов, новых находок: ${body.created}`);
          router.refresh();
        }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
        {busy ? "Сканируем…" : "Сканировать 7 дней"}
      </button>
    </span>
  );
}
