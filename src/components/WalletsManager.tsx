"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Download, Loader2, Network, Pencil, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { CATEGORIES, CATEGORY_LABEL, categoryVar, fmtAgo, fmtCompact, fmtDate, fmtNum, shortAddr } from "@/lib/format";
import { runJob } from "@/lib/jobs-client";
import { CategoryBadge } from "./CategoryBadge";

interface Wallet {
  address: string;
  label: string;
  category: string;
  notes: string | null;
  usdtBalance: number | null;
  trxBalance: number | null;
  balanceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  backfilledAt: string | null;
  historyFrom: string | null;
  syncError: string | null;
  tags: { name: string; source: "MANUAL" | "AUTO" }[];
}

interface Draft {
  address: string;
  label: string;
  category: string;
  tags: string;
  notes: string;
}

const emptyDraft: Draft = { address: "", label: "", category: "UNKNOWN", tags: "", notes: "" };
const splitTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * Разбор списка для импорта: строка = «адрес, метка, категория, теги…».
 * Разделитель — запятая, точка с запятой или таб; строка-заголовок пропускается.
 */
function parseImport(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^address\b/i.test(l))
    .map((line) => {
      const [address = "", label = "", category = "", ...tags] = line.split(/[;,\t]/).map((c) => c.trim());
      const cat = category.toUpperCase();
      return {
        address,
        label: label || shortAddr(address),
        category: (CATEGORIES as readonly string[]).includes(cat) ? cat : "UNKNOWN",
        tags: tags.filter(Boolean),
      };
    });
}

interface Totals {
  usdt: number;
  trx: number;
  count: number;
  withoutBalance: number;
  oldestUpdate: number | null;
  byCategory: { category: string; usdt: number; count: number }[];
}

function totalsOf(list: Wallet[]): Totals {
  const byCat = new Map<string, { usdt: number; count: number }>();
  let usdt = 0;
  let trx = 0;
  let withoutBalance = 0;
  let oldest: number | null = null;
  for (const w of list) {
    if (w.usdtBalance == null) withoutBalance++;
    usdt += w.usdtBalance ?? 0;
    trx += w.trxBalance ?? 0;
    if (w.balanceUpdatedAt) {
      const t = new Date(w.balanceUpdatedAt).getTime();
      oldest = oldest === null ? t : Math.min(oldest, t);
    }
    const c = byCat.get(w.category) ?? { usdt: 0, count: 0 };
    c.usdt += w.usdtBalance ?? 0;
    c.count++;
    byCat.set(w.category, c);
  }
  return {
    usdt,
    trx,
    count: list.length,
    withoutBalance,
    oldestUpdate: oldest,
    byCategory: CATEGORIES.filter((c) => byCat.has(c)).map((c) => ({ category: c, ...byCat.get(c)! })).sort((a, b) => b.usdt - a.usdt),
  };
}

/** Сколько денег на кошельках книги: итог, TRX, разбивка по категориям. */
function BalanceSummary({ all, shown, filtered }: { all: Totals; shown: Totals; filtered: boolean }) {
  return (
    <section className="card grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" aria-labelledby="total-h">
      <div className="min-w-0">
        <h2 id="total-h" className="text-fg-2 text-xs">
          Всего на кошельках книги
        </h2>
        <div className="display num mt-1.5 text-2xl font-semibold break-words">
          {fmtNum(Math.round(all.usdt))} <span className="text-fg-2 text-lg">USDT</span>
        </div>
        <dl className="text-fg-2 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>TRX на комиссии</dt>
          <dd className="num text-fg">{fmtNum(Math.round(all.trx))} TRX</dd>
          <dt>Кошельков</dt>
          <dd className="num text-fg">
            {all.count}
            {all.withoutBalance > 0 && <span className="text-muted">, у {all.withoutBalance} баланс ещё загружается</span>}
          </dd>
          {all.oldestUpdate !== null && (
            <>
              <dt>Балансы на</dt>
              <dd className="text-fg" title="Самое старое обновление среди кошельков">
                {fmtDate(all.oldestUpdate)} или позже
              </dd>
            </>
          )}
        </dl>
        {filtered && (
          <p className="bg-surface-2 mt-4 rounded-md px-3 py-2 text-sm">
            В выборке по фильтру: <b className="num">{fmtNum(Math.round(shown.usdt))} USDT</b> на {shown.count} кош.
            {all.usdt > 0 && <span className="text-fg-2"> ({Math.round((shown.usdt / all.usdt) * 100)} % от всех)</span>}
          </p>
        )}
      </div>

      {all.usdt > 0 && (
        <div className="min-w-0">
          <h3 className="text-fg-2 text-xs">По категориям</h3>
          <div className="mt-2.5 flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {all.byCategory
              .filter((c) => c.usdt > 0)
              .map((c) => (
                <div key={c.category} style={{ flexGrow: c.usdt, background: categoryVar(c.category) }} title={CATEGORY_LABEL[c.category]} />
              ))}
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {all.byCategory.map((c) => (
                <tr key={c.category} className="border-line border-t first:border-t-0">
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: categoryVar(c.category) }} />
                      {CATEGORY_LABEL[c.category]}
                      <span className="text-muted text-xs">{c.count} кош.</span>
                    </span>
                  </td>
                  <td className="num py-1.5 text-right">{fmtCompact(c.usdt)}</td>
                  <td className="num text-fg-2 w-14 py-1.5 text-right">{Math.round((c.usdt / all.usdt) * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function WalletsManager() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [catFilter, setCatFilter] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importReport, setImportReport] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWallets(await api<Wallet[]>("/api/wallets"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // статусы синхронизации меняются воркером в фоне
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (wallets ?? []).filter(
      (w) =>
        (!catFilter || w.category === catFilter) &&
        (!q ||
          w.label.toLowerCase().includes(q) ||
          w.address.toLowerCase().includes(q) ||
          w.tags.some((t) => t.name.toLowerCase().includes(q))),
    );
  }, [wallets, query, catFilter]);
  const totalAll = useMemo(() => totalsOf(wallets ?? []), [wallets]);
  const totalShown = useMemo(() => totalsOf(filtered), [filtered]);
  const isFiltered = !!(query.trim() || catFilter) && filtered.length !== (wallets?.length ?? 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ ...draft, tags: splitTags(draft.tags), notes: draft.notes || undefined }),
      });
      setDraft(emptyDraft);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runImport() {
    const items = parseImport(importText);
    if (!items.length) return;
    setSaving(true);
    try {
      const r = await api<{ results: { created: boolean }[]; errors: { index: number; error: string }[] }>("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      const created = r.results.filter((x) => x.created).length;
      const lines = [`Добавлено: ${created}, обновлено: ${r.results.length - created}, с ошибками: ${r.errors.length}`];
      for (const e of r.errors.slice(0, 20)) lines.push(`строка ${e.index + 1} (${items[e.index].address || "пусто"}): ${e.error}`);
      setImportReport(lines.join("\n"));
      if (!r.errors.length) setImportText("");
      await load();
    } catch (err) {
      setImportReport((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(address: string) {
    setBusy((b) => ({ ...b, [address]: "save" }));
    try {
      await api(`/api/wallets/${address}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: editDraft.label,
          category: editDraft.category,
          notes: editDraft.notes,
          tags: splitTags(editDraft.tags),
        }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(({ [address]: _, ...rest }) => rest);
    }
  }

  async function remove(w: Wallet) {
    if (!confirm(`Удалить «${w.label}» из адресной книги? Уже загруженные переводы останутся в базе.`)) return;
    setBusy((b) => ({ ...b, [w.address]: "delete" }));
    try {
      await api(`/api/wallets/${w.address}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(({ [w.address]: _, ...rest }) => rest);
    }
  }

  async function sync(address: string) {
    setBusy((b) => ({ ...b, [address]: "sync" }));
    const r = await runJob(`/api/wallets/${address}/sync`);
    setBusy(({ [address]: _, ...rest }) => rest);
    if (!r.ok) alert(`Синхронизация не удалась: ${r.error}`);
    await load();
  }

  function status(w: Wallet) {
    if (w.syncError) return <span className="text-critical text-xs" title={w.syncError}>ошибка: {w.syncError.slice(0, 40)}</span>;
    if (!w.backfilledAt) return <span className="text-muted text-xs">загрузка истории…</span>;
    return (
      <span className="text-fg-2 text-xs" title={w.historyFrom ? `история с ${fmtDate(w.historyFrom, false)}` : undefined}>
        {w.lastSyncedAt ? `${fmtAgo(Date.now() - new Date(w.lastSyncedAt).getTime())} назад` : "—"}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {wallets && wallets.length > 0 && <BalanceSummary all={totalAll} shown={totalShown} filtered={isFiltered} />}

      <form onSubmit={add} className="card grid gap-3 p-4 md:grid-cols-[2fr_1.2fr_1fr_1.2fr_auto]" aria-label="Добавить кошелёк">
        <input
          className="input addr"
          placeholder="Адрес TRC-20 (T…)"
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value.trim() })}
          required
          spellCheck={false}
        />
        <input className="input" placeholder="Метка, напр. «OTC Desk A»" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required />
        <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Категория">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Теги через запятую" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
        <button type="submit" className="btn-primary justify-center" disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />} Добавить
        </button>
        {formError && <p className="text-critical text-sm md:col-span-5" role="alert">{formError}</p>}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-64" placeholder="Поиск: метка, адрес, тег" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Фильтр по категории">
          <option value="">Все категории</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <span className="text-muted text-sm">{wallets ? `${filtered.length} из ${wallets.length}` : ""}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={() => setShowImport((v) => !v)}>
            <Upload size={14} aria-hidden /> Импорт списка
          </button>
          <a className="btn" href="/api/export/wallets?period=30d">
            <Download size={14} aria-hidden /> CSV
          </a>
        </div>
      </div>

      {showImport && (
        <section className="card space-y-3 p-4" aria-label="Импорт списка">
          <p className="text-fg-2 text-sm">
            По одному кошельку в строке: <span className="addr">адрес, метка, категория, тег1, тег2…</span> Категории:{" "}
            {CATEGORIES.join(", ")}. Подходит вставка из Excel/Google Sheets.
          </p>
          <textarea
            className="input addr h-40 w-full"
            placeholder={"TXxx…, Exchanger Yerevan Center, EXCHANGE, Ереван\nTYyy…, OTC Desk A, OTC"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
          />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={saving || !importText.trim()} onClick={runImport}>
              Импортировать {parseImport(importText).length || ""}
            </button>
            {importReport && <pre className="text-fg-2 text-xs whitespace-pre-wrap">{importReport}</pre>}
          </div>
        </section>
      )}

      {loadError && <p className="text-critical text-sm">Не удалось загрузить список: {loadError}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-fg-2 text-left text-xs">
            <tr>
              <th className="px-4 py-2 font-medium">Метка / адрес</th>
              <th className="px-4 py-2 font-medium">Категория</th>
              <th className="px-4 py-2 font-medium">Теги</th>
              <th className="px-4 py-2 text-right font-medium">USDT</th>
              <th className="px-4 py-2 text-right font-medium">TRX</th>
              <th className="px-4 py-2 font-medium">Синхронизация</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {wallets === null && (
              <tr>
                <td colSpan={7} className="text-muted px-4 py-6 text-center">
                  Загрузка…
                </td>
              </tr>
            )}
            {wallets?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted px-4 py-6 text-center">
                  Кошельков пока нет — добавьте первый или импортируйте список.
                </td>
              </tr>
            )}
            {filtered.map((w) =>
              editing === w.address ? (
                <tr key={w.address} className="border-line bg-surface-2 border-t">
                  <td className="px-4 py-2">
                    <input className="input w-full" value={editDraft.label} onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })} aria-label="Метка" />
                    <input className="input mt-1 w-full text-xs" placeholder="Заметки" value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} aria-label="Заметки" />
                  </td>
                  <td className="px-4 py-2">
                    <select className="input" value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} aria-label="Категория">
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2" colSpan={4}>
                    <input className="input w-full" placeholder="Теги через запятую" value={editDraft.tags} onChange={(e) => setEditDraft({ ...editDraft, tags: e.target.value })} aria-label="Теги" />
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <button type="button" className="btn" onClick={() => saveEdit(w.address)} disabled={!!busy[w.address]} aria-label="Сохранить">
                      <Check size={14} aria-hidden />
                    </button>{" "}
                    <button type="button" className="btn" onClick={() => setEditing(null)} aria-label="Отмена">
                      <X size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={w.address} className="border-line border-t">
                  <td className="px-4 py-2">
                    <Link href={`/wallets/${w.address}`} className="font-medium hover:underline">
                      {w.label}
                    </Link>
                    <div className="text-muted flex items-center gap-1 text-xs">
                      <span className="addr" title={w.address}>{shortAddr(w.address)}</span>
                      <button
                        type="button"
                        className="hover:text-fg"
                        aria-label="Скопировать адрес"
                        onClick={async () => {
                          await navigator.clipboard.writeText(w.address);
                          setCopied(w.address);
                          setTimeout(() => setCopied(null), 1200);
                        }}
                      >
                        {copied === w.address ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2"><CategoryBadge category={w.category} /></td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {w.tags.map((t) => (
                        <span key={t.name} className="bg-surface-2 text-fg-2 rounded px-1.5 py-0.5 text-xs" title={t.source === "AUTO" ? "проставлен эвристикой графа" : undefined}>
                          {t.source === "AUTO" ? "⚙ " : ""}
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num px-4 py-2 text-right">{w.usdtBalance == null ? "—" : fmtNum(w.usdtBalance)}</td>
                  <td className="num text-fg-2 px-4 py-2 text-right">{w.trxBalance == null ? "—" : fmtNum(w.trxBalance)}</td>
                  <td className="px-4 py-2">{status(w)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn px-2" title="Синхронизировать сейчас" onClick={() => sync(w.address)} disabled={!!busy[w.address]}>
                        <RefreshCw size={14} className={busy[w.address] === "sync" ? "animate-spin" : ""} aria-hidden />
                        <span className="sr-only">Синхронизировать</span>
                      </button>
                      <Link className="btn px-2" href={`/graph?focus=${w.address}`} title="Граф связей">
                        <Network size={14} aria-hidden />
                        <span className="sr-only">Граф</span>
                      </Link>
                      <button
                        type="button"
                        className="btn px-2"
                        title="Редактировать"
                        onClick={() => {
                          setEditing(w.address);
                          setEditDraft({ address: w.address, label: w.label, category: w.category, notes: w.notes ?? "", tags: w.tags.map((t) => t.name).join(", ") });
                        }}
                      >
                        <Pencil size={14} aria-hidden />
                        <span className="sr-only">Редактировать</span>
                      </button>
                      <button type="button" className="btn px-2" title="Удалить" onClick={() => remove(w)} disabled={!!busy[w.address]}>
                        <Trash2 size={14} aria-hidden />
                        <span className="sr-only">Удалить</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
          {filtered.length > 1 && (
            <tfoot>
              <tr className="border-line-strong border-t-2 font-semibold">
                <td className="px-4 py-2.5" colSpan={3}>
                  Итого{isFiltered ? " по выборке" : ""}: {filtered.length} кош.
                </td>
                <td className="num px-4 py-2.5 text-right">{fmtNum(totalShown.usdt)}</td>
                <td className="num px-4 py-2.5 text-right">{fmtNum(totalShown.trx)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
