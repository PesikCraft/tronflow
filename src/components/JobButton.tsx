"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { runJob } from "@/lib/jobs-client";

/** Кнопка, которая ставит задачу воркеру и обновляет страницу по завершении. */
export function JobButton({ url, children, title }: { url: string; children: React.ReactNode; title?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn"
        title={title}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await runJob(url);
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(r.error ?? "ошибка");
        }}
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {children}
      </button>
      {error && <span className="text-critical text-xs">{error}</span>}
    </span>
  );
}
