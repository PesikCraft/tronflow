"use client";

import { useEffect, useRef, useState } from "react";
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format";

/** Линия во времени (история баланса) с перекрестием и тултипом. */
export function LineChart({ points, title, height = 180 }: { points: { ts: number; value: number }[]; title: string; height?: number }) {
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

  const pad = { l: 44, r: 8, t: 8, b: 20 };
  const w = Math.max(width, 100);
  const minT = points[0]?.ts ?? 0;
  const maxT = points[points.length - 1]?.ts ?? 1;
  const maxV = Math.max(...points.map((p) => p.value), 1);
  const x = (t: number) => pad.l + ((t - minT) / Math.max(maxT - minT, 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxV) * (height - pad.t - pad.b);
  // Баланс меняется скачками — ступенчатая линия честнее, чем интерполяция
  const d = points.map((p, i) => (i === 0 ? `M${x(p.ts)},${y(p.value)}` : `H${x(p.ts)}V${y(p.value)}`)).join("");

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.ts) - px) < Math.abs(x(points[best].ts) - px)) best = i;
    });
    setHover(best);
  }

  return (
    <figure className="card p-5">
      <figcaption className="panel-title mb-3">{title}</figcaption>
      <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
        {points.length < 2 ? (
          <div className="text-muted flex items-center justify-center text-sm" style={{ height }}>
            Недостаточно замеров за период
          </div>
        ) : width === 0 ? (
          <div style={{ height }} />
        ) : (
          <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={w - pad.r} y1={y(maxV * f)} y2={y(maxV * f)} stroke="var(--grid)" />
                <text x={pad.l - 6} y={y(maxV * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">
                  {fmtCompact(maxV * f)}
                </text>
              </g>
            ))}
            <path d={d} fill="none" stroke="var(--series)" strokeWidth={2} />
            {hover !== null && (
              <>
                <line x1={x(points[hover].ts)} x2={x(points[hover].ts)} y1={pad.t} y2={height - pad.b} stroke="var(--axis)" />
                <circle cx={x(points[hover].ts)} cy={y(points[hover].value)} r={4} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />
              </>
            )}
            <text x={pad.l} y={height - 4} fontSize="11" fill="var(--muted)">{fmtDate(minT)}</text>
            <text x={w - pad.r} y={height - 4} fontSize="11" fill="var(--muted)" textAnchor="end">{fmtDate(maxT)}</text>
          </svg>
        )}
        {hover !== null && points[hover] && (
          <div
            role="tooltip"
            className="card pointer-events-none absolute top-0 z-10 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(x(points[hover].ts) + 8, w - 150) }}
          >
            <div className="text-fg-2">{fmtDate(points[hover].ts)}</div>
            <div className="num font-semibold">{fmtNum(points[hover].value)} USDT</div>
          </div>
        )}
      </div>
    </figure>
  );
}
