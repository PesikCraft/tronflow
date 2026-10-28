/**
 * Разбор RSS 2.0 и Atom без сторонних библиотек: из ленты нужны только заголовок,
 * ссылка, дата и краткое описание. Ленты крупных изданий хорошо сформированы,
 * поэтому хватает регулярных выражений по блокам <item>/<entry>.
 */

export interface FeedItem {
  title: string;
  url: string;
  /** ms since epoch; null — в ленте нет даты */
  publishedAt: number | null;
  summary: string;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Тег — только «<буква…>»: так «BTC < $100k» в тексте не принимается за разметку. */
const stripTags = (s: string) => s.replace(/<\/?[a-z][^>]*>/gi, " ");

/** Текст элемента: CDATA раскрывается, HTML внутри (в том числе экранированный) убирается. */
export function cleanText(raw: string | undefined) {
  if (!raw) return "";
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c);
  return stripTags(decodeEntities(stripTags(unwrapped))).replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];
}

/** RSS: <link>url</link>; Atom: <link rel="alternate" href="url"/> (rel по умолчанию — alternate). */
function link(block: string) {
  const text = cleanText(tag(block, "link"));
  if (text) return text;
  for (const m of block.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const attrs = m[1];
    const rel = /\brel="([^"]*)"/i.exec(attrs)?.[1] ?? "alternate";
    const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
    if (href && rel === "alternate") return decodeEntities(href);
  }
  const guid = cleanText(tag(block, "guid"));
  return /^https?:\/\//.test(guid) ? guid : "";
}

function date(block: string) {
  for (const name of ["pubDate", "published", "updated", "dc:date"]) {
    const v = cleanText(tag(block, name));
    const ms = v ? Date.parse(v) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)];
  return blocks
    .map(([block]) => ({
      title: cleanText(tag(block, "title")),
      url: link(block),
      publishedAt: date(block),
      summary: cleanText(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content")).slice(0, 600),
    }))
    .filter((i) => i.title && i.url);
}
