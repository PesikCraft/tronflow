"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import type { FlowTransfer, WalletMeta } from "@/lib/graph/types";
import { runJob } from "@/lib/jobs-client";
import { shortAddr } from "@/lib/format";

// Cytoscape работает только в браузере
const FlowGraph = dynamic(() => import("./FlowGraph").then((m) => m.FlowGraph), {
  ssr: false,
  loading: () => <div className="card text-muted flex h-[75vh] items-center justify-center text-sm">Загрузка графа…</div>,
});

const PERIODS = ["1d", "7d", "30d", "90d"] as const;

interface GraphResponse {
  transfers: FlowTransfer[];
  wallets: WalletMeta[];
  truncated: boolean;
}

export function GraphExplorer() {
  const router = useRouter();
  const params = useSearchParams();
  const focus = params.get("focus") ?? undefined;
  const period = (PERIODS as readonly string[]).includes(params.get("period") ?? "") ? params.get("period")! : "30d";

  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanding, setExpanding] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ period });
      if (focus) q.set("focus", focus);
      const res = await fetch(`/api/graph?${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, focus]);

  useEffect(() => {
    load();
  }, [load]);

  const seeds = useMemo(() => (focus ? [focus] : undefined), [focus]);
  const focusLabel = data?.wallets.find((w) => w.address === focus)?.label ?? (focus ? shortAddr(focus) : "");

  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(params);
    if (v === null) q.delete(k);
    else q.set(k, v);
    router.push(`/graph?${q}`);
  };

  async function expand(address: string) {
    setExpanding(address);
    setNotice(null);
    const r = await runJob(`/api/wallets/${address}/expand`);
    setExpanding(null);
    if (!r.ok) {
      setNotice(`Не удалось загрузить связи: ${r.error}`);
      return;
    }
    await load();
  }

  async function addToBook(input: { address: string; label: string; category: string; autoTags: string[] }) {
    const res = await fetch("/api/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    setNotice(`«${input.label}» добавлен в адресную книгу — воркер загрузит его историю.`);
    await load();
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="display text-xl font-semibold">Граф связей</h1>
        {focus && (
          <span className="bg-surface-2 inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm">
            Фокус: <Link href={`/wallets/${focus}`} className="font-medium hover:underline">{focusLabel}</Link>
            <button type="button" aria-label="Сбросить фокус" onClick={() => setParam("focus", null)} className="text-muted hover:text-fg">
              <X size={14} />
            </button>
          </span>
        )}
        <div className="border-line bg-surface ml-auto inline-flex rounded-md border p-0.5" role="group" aria-label="Период">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setParam("period", p)}
              aria-pressed={p === period}
              className={`rounded px-3 py-1 text-sm ${p === period ? "bg-surface-2 text-fg font-semibold" : "text-fg-2 hover:text-fg"}`}
            >
              {p}
            </button>
          ))}
        </div>
        {loading && <Loader2 size={16} className="text-muted animate-spin" aria-label="Загрузка" />}
      </header>

      {error && <p className="text-critical text-sm">Ошибка загрузки: {error}</p>}
      {notice && <p className="card text-fg-2 px-3 py-2 text-sm">{notice}</p>}
      {data?.truncated && (
        <p className="text-fg-2 text-xs">Загружены 15 000 крупнейших переводов периода — мелкие отброшены на сервере.</p>
      )}

      {data && (
        <FlowGraph
          key={focus ?? "book"}
          transfers={data.transfers}
          wallets={data.wallets}
          seeds={seeds}
          defaultDepth={focus ? 2 : 1}
          onExpand={expand}
          onAddToBook={addToBook}
          expanding={expanding}
        />
      )}
    </div>
  );
}
