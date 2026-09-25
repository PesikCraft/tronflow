const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export const fmtCompact = (v: number) => compact.format(v);
export const fmtNum = (v: number) => full.format(v);
export const fmtUsdt = (v: number | null | undefined) => (v == null ? "—" : `${full.format(v)} USDT`);

const TZ = "Asia/Yerevan";

export function fmtDate(v: Date | string | number | null | undefined, withTime = true) {
  if (v == null) return "—";
  return new Date(v).toLocaleString("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: withTime ? undefined : "numeric",
    hour: withTime ? "2-digit" : undefined,
    minute: withTime ? "2-digit" : undefined,
  });
}

export function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} с`;
  if (s < 5400) return `${Math.round(s / 60)} мин`;
  if (s < 172_800) return `${Math.round(s / 3600)} ч`;
  return `${Math.round(s / 86_400)} дн`;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const tronscanUrl = (a: string) => `https://tronscan.org/#/address/${a}`;
export const tronscanTx = (h: string) => `https://tronscan.org/#/transaction/${h}`;

export const CATEGORIES = ["EXCHANGE", "OTC", "TRADER", "WHALE", "SUSPICIOUS", "UNKNOWN"] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  EXCHANGE: "Обменник",
  OTC: "OTC",
  TRADER: "Трейдер",
  WHALE: "Кит",
  SUSPICIOUS: "Подозрительный",
  UNKNOWN: "Неизвестный",
};

export const fmtSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v))}`;
export const fmtSignedCompact = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtCompact(Math.abs(v))}`;

/** CSS-переменная цвета категории (значения — в globals.css, отдельно для светлой/тёмной темы). */
export const categoryVar = (c: string) => `var(--cat-${(c in CATEGORY_LABEL ? c : "UNKNOWN").toLowerCase()})`;
