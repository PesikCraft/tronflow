/**
 * Разбор новости по словарям — бесплатно и предсказуемо, без языковой модели:
 *   assets    — какие монеты затронуты (MARKET — макро и регуляторика, весь рынок);
 *   sentiment — рост / падение / нейтрально по словам заголовка (описание — с половинным весом);
 *   impact    — важность 1–10: источник, тема, суммы в долларах, тяжёлые события.
 * reasons объясняют оценку в интерфейсе. Это подсказка аналитику, а не прогноз цены.
 * Чистые функции — покрыты тестами (tests/news.test.ts).
 */
import type { NewsSource } from "./sources";

export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface Classification {
  relevant: boolean;
  assets: string[];
  sentiment: Sentiment;
  /** −1…1: знак — направление, модуль — насколько однозначно */
  score: number;
  impact: number;
  reasons: string[];
}

/** Фильтры по монетам в интерфейсе и в правилах уведомлений. */
export const NEWS_ASSETS = ["BTC", "ETH", "XRP", "SOL", "MARKET"] as const;
export const assetLabel = (a: string) => (a === "MARKET" ? "Рынок" : a);

// Тикеры — с учётом регистра (SOL, LINK, TON — обычные слова), названия — без.
const ASSET_RULES: [string, RegExp[]][] = [
  ["BTC", [/\bbitcoin\b/i, /\bBTC\b/]],
  ["ETH", [/\bethereum\b/i, /\bether\b/i, /\bETH\b/]],
  ["XRP", [/\bXRP\b/, /\bripple\b/i]],
  ["SOL", [/\bsolana\b/i, /\bSOL\b/]],
  ["BNB", [/\bBNB\b/]],
  ["DOGE", [/\bdogecoin\b/i, /\bDOGE\b/]],
  ["ADA", [/\bcardano\b/i, /\bADA\b/]],
  ["TRX", [/\bTRON\b/, /\bTron\b/, /\bTRX\b/]],
  ["TON", [/\btoncoin\b/i, /\bTON\b/]],
  ["AVAX", [/\bavalanche\b/i, /\bAVAX\b/]],
  ["LINK", [/\bchainlink\b/i, /\bLINK\b/]],
  ["USDT", [/\btether\b/i, /\bUSDT\b/]],
  ["USDC", [/\bUSDC\b/]],
];

const MACRO = [
  /\b(Fed|FOMC|CPI|SEC|CFTC)\b/,
  /\b(federal reserve|interest rates?|rate (cut|hike)s?|inflation|recession|tariffs?|treasury yields?|crypto market|regulat\w*|stablecoin (bill|act|law)|executive order)\b/i,
];

const CRYPTO_WORDS = /\b(crypto\w*|digital assets?|blockchain|tokens?|stablecoins?|defi|nfts?|web3|bitcoin|ethereum)\b/i;
const MONETARY_WORDS = /\b(FOMC|federal funds|monetary policy|interest rates?|discount rate|Beige Book|economic projections)\b/i;

interface Rule {
  re: RegExp;
  /** > 0 — к росту, < 0 — к падению */
  w: number;
  reason: string;
  /** тяжёлое событие: поднимает важность */
  severe?: boolean;
}

const COIN = String.raw`(bitcoin|btc|ether|eth|xrp|sol|tokens?|coins?|holdings)`;

const RULES: Rule[] = [
  // к росту
  { re: /\b(approv\w*|greenlights?)\b.{0,40}\bETFs?\b|\bETFs?\b.{0,40}\bapprov\w*/i, w: 3, reason: "одобрение ETF" },
  { re: /\bETFs?\b.{0,40}\binflows?\b|\binflows?\b.{0,40}\bETFs?\b/i, w: 2, reason: "приток в ETF" },
  { re: /\b(all[- ]time high|record high|new high|ATH)\b/i, w: 2, reason: "исторический максимум" },
  { re: /\b(surges?|surged|soars?|soared|rall(y|ies|ied)|jumps?|jumped|climbs?|rebounds?|rockets?|skyrockets?)\b/i, w: 1.5, reason: "рост цены" },
  { re: /\b(gains?|rises?|rose)\b/i, w: 1, reason: "рост" },
  { re: /\bbreaks? (above|past|through)\b/i, w: 1, reason: "пробой вверх" },
  { re: new RegExp(String.raw`\b(buys?|bought|purchas\w*|acquires?|acquired)\b.{0,40}\b${COIN}\b`, "i"), w: 1.5, reason: "покупка" },
  { re: /\baccumulat\w*/i, w: 1.5, reason: "накопление" },
  { re: /\b(outflows?|withdrawals?)\b.{0,30}\bexchanges?\b|\bexchanges?\b.{0,30}\boutflows?\b/i, w: 1, reason: "вывод с бирж" },
  { re: /\b(rate cuts?|cuts? (interest )?rates?|lower\w* (interest )?rates?|dovish)\b/i, w: 2, reason: "снижение ставки" },
  { re: /\b(adopt(s|ed|ion)?|legal tender|strategic (bitcoin |crypto )?reserve)\b/i, w: 1.5, reason: "принятие" },
  { re: /\b(dismiss\w*|drops?|dropped|ends?|ended|wins?|won)\b.{0,40}\b(lawsuit|case|charges|appeal)\b/i, w: 2, reason: "конец разбирательства" },
  { re: /\bbullish\b/i, w: 1, reason: "бычий настрой" },
  { re: /\b(partnership|partners with|launch\w*|upgrade)\b/i, w: 0.5, reason: "запуск или партнёрство" },
  // к падению
  { re: /\b(hack\w*|exploit\w*|drained|stolen|breach\w*)\b/i, w: -3, reason: "взлом", severe: true },
  { re: /\b(bankrupt\w*|insolven\w*|collaps\w*|halts? withdrawals|freezes? withdrawals|depeg\w*)\b/i, w: -3, reason: "банкротство или заморозка", severe: true },
  { re: /\bETFs?\b.{0,40}\boutflows?\b|\boutflows?\b.{0,40}\bETFs?\b/i, w: -2, reason: "отток из ETF" },
  { re: /\b(inflows?|deposits?)\b.{0,30}\bexchanges?\b|\bexchanges?\b.{0,30}\binflows?\b/i, w: -1, reason: "приток на биржи" },
  { re: /\b(plunges?|plunged|plummets?|crash\w*|tumbles?|tumbled|slumps?|tanks?|sinks?|nosedives?|sell-?offs?|capitulat\w*)\b/i, w: -2, reason: "падение цены" },
  { re: /\b(falls?|fell|drops?|dropped|slides?|slips?|declines?|dips?)\b/i, w: -1, reason: "снижение" },
  { re: /\bbreaks? (below|under)\b/i, w: -1, reason: "пробой вниз" },
  { re: /\b(sues?|sued|lawsuit|charges?|charged|indict\w*|fraud|subpoena\w*|investigat\w*|probe)\b/i, w: -1.5, reason: "иск или расследование" },
  { re: /\b(bans?|banned|crackdown|prohibit\w*)\b/i, w: -2, reason: "запрет" },
  { re: /\b(liquidat\w*|wiped out)\b/i, w: -1.5, reason: "ликвидации" },
  { re: /\bdelist\w*/i, w: -1.5, reason: "делистинг" },
  { re: /\b(rate hikes?|hikes? (interest )?rates?|raises? (interest )?rates?|hawkish)\b/i, w: -2, reason: "повышение ставки" },
  { re: /\b(rejects?|rejected|denies|denied|delays?|delayed|postpones?)\b.{0,40}\b(ETFs?|application|approval)\b/i, w: -2, reason: "отказ или задержка" },
  { re: /\bbearish\b/i, w: -1, reason: "медвежий настрой" },
  { re: new RegExp(String.raw`\b(dumps?|dumped|sells?|sold|offload\w*)\b.{0,40}\b${COIN}\b`, "i"), w: -1.5, reason: "продажа" },
  { re: /\b(recession|tariffs?)\b/i, w: -1, reason: "макро-риск" },
];

/** «not», «fails to» … прямо перед словом — правило не считается. */
const NEGATION = /\b(no|not|never|fails? to|failed to|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|didn['’]t|denies|denied|without)\s+(\S+\s+){0,2}$/i;
/** Прогнозы и мнения — направление наполовину, важность ниже. («may» не берём: путается с маем.) */
const SPECULATIVE = /\b(price prediction|predicts?|forecasts?|could|might|analysts? says?|opinion|op-ed|sponsored|podcast|recap|explained|how to|guide|what is)\b/i;

const TOPIC = [
  /\b(ETFs?|SEC|FOMC|Fed|CPI|BlackRock|Fidelity|Grayscale|Tether|Binance|Coinbase|Congress|Senate|White House|Trump)\b/,
  /\b(executive order|tariffs?|federal reserve|interest rates?|inflation|stablecoin (bill|act|law))\b/i,
];

function matchRules(text: string) {
  const out: Rule[] = [];
  if (!text) return out;
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m && !NEGATION.test(text.slice(Math.max(0, m.index - 30), m.index))) out.push(r);
  }
  return out;
}

export function detectAssets(text: string) {
  const assets = ASSET_RULES.filter(([, res]) => res.some((re) => re.test(text))).map(([a]) => a);
  if (MACRO.some((re) => re.test(text))) assets.push("MARKET");
  return assets;
}

const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };

/** Самая крупная сумма в долларах в тексте: «$1.2B», «$500 million», «$70,000». */
export function maxUsd(text: string) {
  let max = 0;
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(trillion|billion|million|thousand|bn|mn|[kmbt])?\b/gi)) {
    const v = Number(m[1].replace(/,/g, "")) * (m[2] ? UNIT[m[2].toLowerCase()] : 1);
    if (Number.isFinite(v)) max = Math.max(max, v);
  }
  return max;
}

const fmtUsd = (v: number) =>
  v >= 1e12 ? `$${+(v / 1e12).toFixed(1)} трлн` : v >= 1e9 ? `$${+(v / 1e9).toFixed(1)} млрд` : `$${Math.round(v / 1e6)} млн`;

/**
 * Описание часто пересказывает контекст («после прошлого повышения ставки»): его вес мал,
 * а вклад ограничен — само по себе описание не выводит новость из нейтральных.
 */
const SUMMARY_WEIGHT = 0.25;
const SUMMARY_CAP = 0.5;

export function classifyNews({ title, summary = "", source }: { title: string; summary?: string; source: NewsSource }): Classification {
  const all = `${title}\n${summary}`;
  const titleAssets = detectAssets(title);
  const assets = titleAssets.length ? titleAssets : detectAssets(summary);
  if (source.only === "monetary" && !assets.includes("MARKET")) assets.push("MARKET");

  const relevant =
    source.only === "crypto"
      ? assets.some((a) => a !== "MARKET") || CRYPTO_WORDS.test(all)
      : source.only === "monetary"
        ? MONETARY_WORDS.test(all)
        : true;

  const inTitle = matchRules(title);
  const inSummary = matchRules(summary).filter((r) => !inTitle.includes(r));
  const speculative = SPECULATIVE.test(title) || /\?\s*$/.test(title);
  const fromSummary = SUMMARY_WEIGHT * inSummary.reduce((s, r) => s + r.w, 0);
  let raw = inTitle.reduce((s, r) => s + r.w, 0) + Math.max(-SUMMARY_CAP, Math.min(SUMMARY_CAP, fromSummary));
  if (speculative) raw *= 0.5;
  const score = Math.round(Math.tanh(raw / 3) * 100) / 100;
  const sentiment: Sentiment = score >= 0.25 ? "BULLISH" : score <= -0.25 ? "BEARISH" : "NEUTRAL";
  // Из описания в объяснение — только то, что совпало с итоговым направлением
  const agreeing = sentiment === "NEUTRAL" ? [] : inSummary.filter((r) => Math.sign(r.w) === Math.sign(score));
  const reasons = [...new Set([...inTitle, ...agreeing].map((r) => r.reason))].slice(0, 4);

  let impact = 1 + source.weight;
  const topic = TOPIC.map((re) => re.exec(title)?.[0]).find(Boolean);
  if (topic) {
    impact += 2;
    reasons.push(`тема: ${topic}`);
  }
  if (inTitle.some((r) => r.severe)) impact += 2;
  // Сумма — только из заголовка: в описаниях капитализации и обороты, к событию не относящиеся
  const usd = maxUsd(title);
  if (usd >= 1e8) {
    impact += usd >= 1e9 ? 2 : 1;
    reasons.push(fmtUsd(usd));
  }
  if (assets.some((a) => a === "BTC" || a === "ETH" || a === "MARKET")) impact += 1;
  if (speculative) impact -= 1;

  return { relevant, assets, sentiment, score, impact: Math.max(1, Math.min(10, impact)), reasons };
}

// ---------------------------------------------------------------------------
// Дубли: одна история в разных лентах
// ---------------------------------------------------------------------------

/**
 * Ключ сравнения: заголовок без регистра, пунктуации и лишних пробелов. Не уникален в базе:
 * регулярные заголовки («Federal Reserve issues FOMC statement») повторяются раз в несколько недель.
 */
export const newsKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%]+/gu, " ")
    .trim()
    .slice(0, 200);

const STOP = new Set(
  "the and for with from that this after amid over into says said will its are was has have how why what new than more about as at by in of on to a an is be".split(" "),
);

export function titleTokens(title: string) {
  return new Set(newsKey(title).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Почти одинаковые заголовки (≥ 60 % общих значимых слов) — одна история. */
export function isSameStory(a: Set<string>, b: Set<string>) {
  if (a.size < 4 || b.size < 4) return false;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common) >= 0.6;
}
