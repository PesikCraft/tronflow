"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { ALERT_TYPES, DEFAULT_PARAMS, PATTERN_TYPES, TYPE_INFO, type AlertTypeName } from "@/lib/alerts/rules";
import { CATEGORIES, CATEGORY_LABEL, fmtAgo } from "@/lib/format";

interface Rule {
  id: number;
  type: AlertTypeName;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
  categories: string[];
  addresses: string[];
  cooldownMin: number;
  description: string;
  events: number;
  lastEventAt: string | null;
}

type Draft = Omit<Rule, "id" | "description" | "events" | "lastEventAt">;

const PATTERN_NAMES = { FAN_OUT: "Рассылка", FAN_IN: "Сбор", LOOP: "Кольцо" } as const;

const newDraft = (type: AlertTypeName = "WHALE"): Draft => ({
  type,
  name: TYPE_INFO[type].title,
  enabled: true,
  params: { ...DEFAULT_PARAMS[type] } as Record<string, unknown>,
  categories: [],
  addresses: [],
  cooldownMin: type === "VOLUME_SPIKE" ? 60 : 0,
});

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function NumberField({ label, value, onChange, suffix, step = 1 }: { label: string; value: unknown; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-fg-2 text-xs">{label}</span>
      <span className="flex items-center gap-2">
        <input type="number" step={step} className="input w-36" value={String(value ?? "")} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="text-muted text-xs">{suffix}</span>}
      </span>
    </label>
  );
}

function RuleForm({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [addresses, setAddresses] = useState(initial.addresses.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = d.params;
  const setP = (k: string, v: unknown) => setD({ ...d, params: { ...p, [k]: v } });

  return (
    <form
      className="bg-surface-2/50 space-y-4 rounded-lg p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await onSave({ ...d, addresses: addresses.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean) });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-fg-2 text-xs">Тип</span>
          <select
            className="input"
            value={d.type}
            onChange={(e) => {
              const t = e.target.value as AlertTypeName;
              setD({ ...newDraft(t), name: d.name === TYPE_INFO[d.type].title ? TYPE_INFO[t].title : d.name });
            }}
          >
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_INFO[t].title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-60 flex-1 flex-col gap-1">
          <span className="text-fg-2 text-xs">Название в сообщении</span>
          <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required maxLength={120} />
        </label>
      </div>
      <p className="text-fg-2 text-xs">{TYPE_INFO[d.type].description}</p>

      <div className="flex flex-wrap gap-4">
        {(d.type === "WHALE" || d.type === "NEW_COUNTERPARTY") && (
          <NumberField label="Сумма перевода от" value={p.minAmount} onChange={(v) => setP("minAmount", v)} suffix="USDT" step={100} />
        )}
        {d.type === "VOLUME_SPIKE" && (
          <>
            <NumberField label="Окно" value={p.windowMin} onChange={(v) => setP("windowMin", v)} suffix="мин" />
            <NumberField label="Выше нормы на" value={p.spikePct} onChange={(v) => setP("spikePct", v)} suffix="%" step={10} />
            <NumberField label="Не меньше" value={p.minVolume} onChange={(v) => setP("minVolume", v)} suffix="USDT" step={1000} />
            <NumberField label="Норма по последним" value={p.baselineDays} onChange={(v) => setP("baselineDays", v)} suffix="дн." />
            <NumberField label="Не чаще раза в" value={d.cooldownMin} onChange={(v) => setD({ ...d, cooldownMin: v })} suffix="мин" step={15} />
          </>
        )}
        {d.type === "PATTERN" && (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-fg-2 text-xs">Какие паттерны</legend>
              <div className="flex gap-3 pt-1">
                {PATTERN_TYPES.map((t) => {
                  const list = (p.patternTypes as string[]) ?? [];
                  return (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={list.includes(t)}
                        onChange={(e) => setP("patternTypes", e.target.checked ? [...list, t] : list.filter((x) => x !== t))}
                      />
                      {PATTERN_NAMES[t]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <NumberField label="Уверенность от" value={p.minScore} onChange={(v) => setP("minScore", v)} suffix="(0–1)" step={0.05} />
          </>
        )}
      </div>

      <fieldset>
        <legend className="text-fg-2 text-xs">Для каких кошельков. Ничего не выбрано — вся адресная книга</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={d.categories.includes(c)}
                onChange={(e) => setD({ ...d, categories: e.target.checked ? [...d.categories, c] : d.categories.filter((x) => x !== c) })}
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
        <textarea
          className="input addr mt-2 h-16 w-full text-xs"
          placeholder="и/или конкретные адреса, по одному в строке"
          value={addresses}
          onChange={(e) => setAddresses(e.target.value)}
          spellCheck={false}
        />
      </fieldset>

      {error && (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          Сохранить правило
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function RulesManager() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRules(await api("/api/alerts/rules"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: number | "new", d: Draft) => {
    await api(id === "new" ? "/api/alerts/rules" : `/api/alerts/rules/${id}`, {
      method: id === "new" ? "POST" : "PATCH",
      body: JSON.stringify(d),
    });
    setEditing(null);
    await load();
  };

  return (
    <section className="card min-w-0 p-5" aria-labelledby="rules-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="rules-h" className="panel-title">
          Правила
        </h2>
        {editing !== "new" && (
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden /> Новое правило
          </button>
        )}
      </div>
      {error && <p className="text-critical mt-3 text-sm">{error}</p>}
      {editing === "new" && (
        <div className="mt-4">
          <RuleForm initial={newDraft()} onSave={(d) => save("new", d)} onCancel={() => setEditing(null)} />
        </div>
      )}
      <ul className="mt-3">
        {rules?.map((r) =>
          editing === r.id ? (
            <li key={r.id} className="border-line border-t py-4">
              <RuleForm initial={r} onSave={(d) => save(r.id, d)} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id} className="border-line flex flex-wrap items-center gap-4 border-t py-3.5">
              <label className="relative inline-flex cursor-pointer items-center" title={r.enabled ? "Выключить" : "Включить"}>
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={r.enabled}
                  onChange={async (e) => {
                    await api(`/api/alerts/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) });
                    await load();
                  }}
                  aria-label={`Правило «${r.name}» ${r.enabled ? "включено" : "выключено"}`}
                />
                <span className="bg-surface-2 border-line-strong peer-checked:bg-ink peer-focus-visible:outline-focus h-5 w-9 rounded-full border transition-colors peer-focus-visible:outline-2" />
                <span className="bg-fg-2 peer-checked:bg-ink-fg absolute left-1 size-3 rounded-full transition-transform peer-checked:translate-x-4" />
              </label>
              <div className={`min-w-0 flex-1 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="font-medium">{r.name}</div>
                <div className="text-fg-2 text-xs">
                  {TYPE_INFO[r.type].title}: {r.description}
                  {r.categories.length || r.addresses.length
                    ? `. Только ${[...r.categories.map((c) => CATEGORY_LABEL[c]), ...(r.addresses.length ? [`${r.addresses.length} адр.`] : [])].join(", ")}`
                    : ""}
                </div>
              </div>
              <div className="text-muted text-right text-xs">
                {r.events ? `${r.events} срабатываний` : "ещё не срабатывало"}
                {r.lastEventAt && <div>последнее {fmtAgo(Date.now() - new Date(r.lastEventAt).getTime())} назад</div>}
              </div>
              <div className="flex gap-1">
                <button type="button" className="btn px-2" onClick={() => setEditing(r.id)} title="Изменить">
                  <Pencil size={14} aria-hidden />
                  <span className="sr-only">Изменить</span>
                </button>
                <button
                  type="button"
                  className="btn px-2"
                  title="Удалить"
                  onClick={async () => {
                    if (!window.confirm(`Удалить правило «${r.name}»? Журнал его срабатываний тоже удалится.`)) return;
                    await api(`/api/alerts/rules/${r.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                  <span className="sr-only">Удалить</span>
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
