"use client";

import { useState } from "react";
import { fmtCompact, fmtNum } from "@/lib/format";

export interface BarDatum {
  label: string; // подпись в тултипе
  tick?: string; // подпись под осью (если пусто — не показывается)
  value: number;
  count?: number;
}

/**
 * Одна серия столбцов: тонкие бары, скругление только у верхнего края, зазор 2px,
 * тултип по наведению, таблица значений для доступности.
 */
export function BarChart({
  data,
  title,
  unit = "USDT",
  height = 160,
}: {
  data: BarDatum[];
  title: string;
  unit?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);

  return (
    <figure className="card p-5">
      <figcaption className="panel-title mb-3">{title}</figcaption>
      {max === 0 ? (
        <div className="text-muted flex items-center justify-center text-sm" style={{ height }}>
          Нет данных за период
        </div>
      ) : (
        <div className="relative">
          <div className="text-muted num absolute -top-1 left-0 text-[11px]">{fmtCompact(max)}</div>
          <div
            className="border-(--axis) relative flex items-end gap-[2px] border-b pt-4"
            style={{ height }}
            onMouseLeave={() => setHover(null)}
          >
            <div aria-hidden className="border-(--grid) pointer-events-none absolute inset-x-0 top-4 border-t" />
            {data.map((d, i) => (
              <div
                key={d.label}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                aria-label={`${d.label}: ${fmtNum(d.value)} ${unit}`}
              >
                <div
                  className="w-full rounded-t-[4px] transition-opacity"
                  style={{
                    height: `${(d.value / max) * 100}%`,
                    minHeight: d.value > 0 ? 2 : 0,
                    background: "var(--series)",
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
            {hover !== null && (
              <div
                role="tooltip"
                className="card pointer-events-none absolute z-10 -translate-x-1/2 px-2.5 py-1.5 text-xs shadow-lg"
                style={{ left: `${((hover + 0.5) / data.length) * 100}%`, bottom: height + 4 }}
              >
                <div className="text-fg-2">{data[hover].label}</div>
                <div className="num font-semibold">
                  {fmtNum(data[hover].value)} {unit}
                </div>
                {data[hover].count !== undefined && <div className="text-fg-2 num">{data[hover].count} переводов</div>}
              </div>
            )}
          </div>
          <div className="text-muted mt-1 flex gap-[2px] text-[11px]">
            {data.map((d) => (
              <div key={d.label} className="flex-1 overflow-visible text-center whitespace-nowrap">
                {d.tick ?? ""}
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="mt-3">
        <summary className="text-muted cursor-pointer text-xs">Таблица значений</summary>
        <table className="num mt-2 w-full text-xs">
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-line border-t">
                <td className="text-fg-2 py-1">{d.label}</td>
                <td className="py-1 text-right">{fmtNum(d.value)}</td>
                {d.count !== undefined && <td className="text-fg-2 py-1 text-right">{d.count}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
