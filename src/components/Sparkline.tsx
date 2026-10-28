/**
 * Линия без осей: форма ряда от минимума до максимума. Для величин, которые меняются
 * на проценты (открытый интерес), — от нуля линия была бы плоской.
 */
export function Sparkline({ points, height = 40, label }: { points: { ts: number; value: number }[]; height?: number; label: string }) {
  if (points.length < 2) return <div className="text-muted flex items-center text-xs" style={{ height }}>Мало точек для графика</div>;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const t0 = points[0].ts;
  const dt = points[points.length - 1].ts - t0 || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${(((p.ts - t0) / dt) * 100).toFixed(2)},${((1 - (p.value - min) / span) * 100).toFixed(2)}`).join("");
  return (
    <svg role="img" aria-label={label} viewBox="0 -4 100 108" preserveAspectRatio="none" className="block w-full" style={{ height }}>
      <path d={d} fill="none" stroke="var(--series)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
