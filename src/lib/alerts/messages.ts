/** Шаблоны сообщений Telegram (HTML parse_mode). Чистые функции — покрыты тестами. */
import { escapeHtml as e } from "../telegram";

const TZ = "Asia/Yerevan";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU").replace(/ /g, " ");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const time = (ts: Date | number) =>
  new Date(ts).toLocaleString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export interface LinkCtx {
  /** адрес дашборда, например http://192.168.1.20:3000; пусто — ссылки только на Tronscan */
  dashboardUrl?: string | null;
}

const tronTx = (h: string) => `https://tronscan.org/#/transaction/${h}`;
const tronAddr = (a: string) => `https://tronscan.org/#/address/${a}`;

function party(address: string, label: string | undefined, ctx: LinkCtx) {
  const name = e(label ?? short(address));
  const href = ctx.dashboardUrl ? `${ctx.dashboardUrl}/wallets/${address}` : tronAddr(address);
  return `<a href="${href}">${name}</a>`;
}

export interface TransferInfo {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  ts: Date | number;
}

type Labels = Map<string, string>;

export function whaleMessage(t: TransferInfo, labels: Labels, ruleName: string, ctx: LinkCtx) {
  return [
    `🐋 <b>${n(t.amount)} USDT</b> — ${e(ruleName)}`,
    `${party(t.from, labels.get(t.from), ctx)} → ${party(t.to, labels.get(t.to), ctx)}`,
    `${time(t.ts)} по Еревану · <a href="${tronTx(t.txHash)}">транзакция</a>`,
  ].join("\n");
}

export function newCounterpartyMessage(
  t: TransferInfo,
  counterparty: string,
  labels: Labels,
  ruleName: string,
  ctx: LinkCtx,
) {
  const incoming = t.to !== counterparty;
  const wallet = incoming ? t.to : t.from;
  return [
    `🆕 <b>Новый адрес</b> — ${e(ruleName)}`,
    `<a href="${tronAddr(counterparty)}">${short(counterparty)}</a> ${incoming ? "прислал" : "получил"} <b>${n(t.amount)} USDT</b> ${incoming ? "на" : "с"} ${party(wallet, labels.get(wallet), ctx)}`,
    `Раньше этот адрес в базе не встречался.`,
    `${time(t.ts)} по Еревану · <a href="${tronTx(t.txHash)}">транзакция</a>`,
  ].join("\n");
}

export function spikeMessage(
  p: { current: number; baseline: number; windowMin: number; count: number; topWallets: { label: string; volume: number }[] },
  ruleName: string,
  ctx: LinkCtx,
) {
  const ratio = p.baseline > 0 ? p.current / p.baseline : 0;
  const lines = [
    `📈 <b>Всплеск объёма: ×${ratio.toFixed(1)} к норме</b> — ${e(ruleName)}`,
    `За ${p.windowMin} мин: <b>${n(p.current)} USDT</b> в ${p.count} переводах (норма ~${n(p.baseline)} USDT)`,
  ];
  if (p.topWallets.length) {
    lines.push("Больше всего:", ...p.topWallets.slice(0, 3).map((w) => `• ${e(w.label)}: ${n(w.volume)} USDT`));
  }
  if (ctx.dashboardUrl) lines.push(`<a href="${ctx.dashboardUrl}/liquidity">Открыть ликвидность</a>`);
  return lines.join("\n");
}

const PATTERN_TITLE = { FAN_OUT: "Рассылка", FAN_IN: "Сбор средств", LOOP: "Кольцо переводов" } as const;

export function patternMessage(
  f: { id: number; type: keyof typeof PATTERN_TITLE; address: string; score: number; summary: string },
  labels: Labels,
  ruleName: string,
  ctx: LinkCtx,
) {
  const lines = [
    `🔍 <b>${PATTERN_TITLE[f.type]}</b> (уверенность ${Math.round(f.score * 100)} %) — ${e(ruleName)}`,
    `${party(f.address, labels.get(f.address), ctx)}: ${e(f.summary)}`,
  ];
  if (ctx.dashboardUrl) {
    lines.push(`<a href="${ctx.dashboardUrl}/patterns">Все находки</a> · <a href="${ctx.dashboardUrl}/graph?focus=${f.address}">На графе</a>`);
  }
  return lines.join("\n");
}

/** Сводка, когда за один цикл сработало много событий одного правила — не засыпаем чат. */
export function digestMessage(ruleName: string, icon: string, items: string[], total: number) {
  const shown = items.slice(0, 10);
  return [
    `${icon} <b>${e(ruleName)}: ${total} событий</b>`,
    ...shown.map((s) => `• ${s}`),
    total > shown.length ? `…и ещё ${total - shown.length}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function digestLine(t: TransferInfo, labels: Labels, ctx: LinkCtx) {
  return `${n(t.amount)} USDT: ${party(t.from, labels.get(t.from), ctx)} → ${party(t.to, labels.get(t.to), ctx)} (<a href="${tronTx(t.txHash)}">tx</a>)`;
}
