"use client";

/**
 * Потоки рынка во времени: приток — столбики вверх, отток — вниз от общей нулевой линии
 * (одна ось, одни единицы), чистый поток — линия. Тултип на весь интервал под курсором.
 */
import { useEffect, useRef, useState } from "react";
import type { FlowBucket } from "@/lib/liquidity";
import { fmtCompact, fmtNum, fmtSigned } from "@/lib/format";

function label(b: FlowBucket, bucketHours: number) {
  const d = new Date(b.ts);
  const opts: Intl.DateTimeFormatOptions =
    bucketHours >= 24
      ? { timeZone: "Asia/Yerevan", day: "2-digit", month: "2-digit" }
      : { timeZone: "Asia/Yerevan", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
  return d.toLocaleString("ru-RU", opts);
}

export function FlowChart({ series, bucketHours, height = 240 }: { series: FlowBucket[]; bucketHours: number; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0); // 0 — ещё не измерили, не рисуем
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 48, r: 8, t: 10, b: 24 };
  const n = series.length;
  const max = Math.max(1, ...series.map((b) => Math.max(b.inflow, b.outflow)));
  const plotW = Math.max(10, width - pad.l - pad.r);
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(1, slot - 2); // 2 px зазор между столбиками
  const mid = pad.t + (height - pad.t - pad.b) / 2;
  const half = (height - pad.t - pad.b) / 2;
  const y = (v: number) => mid - (v / max) * half;
  const x = (i: number) => pad.l + i * slot;
  const netPath = series.map((b, i) => `${i ? "L" : "M"}${x(i) + slot / 2},${y(b.net)}`).join("");
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));
  const empty = series.every((b) => b.inflow === 0 && b.outflow === 0);

  return (
    <figure className="min-w-0">
      <div className="text-fg-2 mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--flow-in)" }} /> Приток на рынок (клиенты продают USDT)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--flow-out)" }} /> Отток с рынка (клиенты покупают)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-fg inline-block h-0.5 w-3" /> Чистый поток
        </span>
      </div>

      <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
        {empty ? (
          <div className="text-muted flex items-center justify-center text-sm" style={{ height }}>
            За этот период переводов рынка нет
          </div>
        ) : width === 0 ? (
          <div style={{ height }} />
        ) : (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Приток и отток USDT по интервалам"
            onMouseMove={(e) => {
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
              const i = Math.floor((px - pad.l) / slot);
              setHover(i >= 0 && i < n ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            {[1, 0.5, -0.5, -1].map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--grid)" />
                <text x={pad.l - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">
                  {f > 0 ? "+" : "−"}
                  {fmtCompact(max * Math.abs(f))}
                </text>
              </g>
            ))}
            {hover !== null && <rect x={x(hover)} y={pad.t} width={slot} height={height - pad.t - pad.b} fill="var(--surface-2)" />}
            {series.map((b, i) => (
              <g key={b.ts}>
                {b.inflow > 0 && (
                  <rect x={x(i) + 1} y={y(b.inflow)} width={barW} height={Math.max(1, mid - y(b.inflow))} rx={Math.min(3, barW / 2)} fill="var(--flow-in)" />
                )}
                {b.outflow > 0 && (
                  <rect x={x(i) + 1} y={mid} width={barW} height={Math.max(1, y(-b.outflow) - mid)} rx={Math.min(3, barW / 2)} fill="var(--flow-out)" />
                )}
              </g>
            ))}
            <line x1={pad.l} x2={width - pad.r} y1={mid} y2={mid} stroke="var(--axis)" />
            <path d={netPath} fill="none" stroke="var(--fg)" strokeWidth={1.5} strokeLinejoin="round" />
            {hover !== null && <circle cx={x(hover) + slot / 2} cy={y(series[hover].net)} r={4} fill="var(--fg)" stroke="var(--surface)" strokeWidth={2} />}
            {series.map((b, i) =>
              i % tickEvery === 0 ? (
                <text key={b.ts} x={x(i) + slot / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">
                  {label(b, bucketHours)}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {hover !== null && series[hover] && (
          <div
            role="tooltip"
            className="card pointer-events-none absolute top-2 z-10 px-3 py-2 text-xs"
            style={{ left: Math.min(Math.max(x(hover) + slot + 8, pad.l), width - 190) }}
          >
            <div className="text-fg-2">{label(series[hover], bucketHours)}</div>
            <div className="num mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
              <span className="text-fg-2">Приток</span>
              <span className="text-right">{fmtNum(series[hover].inflow)}</span>
              <span className="text-fg-2">Отток</span>
              <span className="text-right">{fmtNum(series[hover].outflow)}</span>
              <span className="text-fg-2">Нетто</span>
              <span className="text-right font-semibold">{fmtSigned(series[hover].net)}</span>
            </div>
          </div>
        )}
      </div>

      <details className="mt-3">
        <summary className="text-muted cursor-pointer text-xs">Таблица значений</summary>
        <div className="max-h-64 overflow-y-auto">
          <table className="mt-2 w-full text-xs">
            <thead className="text-fg-2 text-left">
              <tr>
                <th className="py-1 font-medium">Интервал</th>
                <th className="py-1 text-right font-medium">Приток</th>
                <th className="py-1 text-right font-medium">Отток</th>
                <th className="py-1 text-right font-medium">Нетто</th>
              </tr>
            </thead>
            <tbody>
              {series.map((b) => (
                <tr key={b.ts} className="border-line border-t">
                  <td className="text-fg-2 py-1">{label(b, bucketHours)}</td>
                  <td className="py-1 text-right">{fmtNum(b.inflow)}</td>
                  <td className="py-1 text-right">{fmtNum(b.outflow)}</td>
                  <td className="py-1 text-right">{fmtSigned(b.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
