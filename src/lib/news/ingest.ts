/**
 * Новости: RSS-ленты -> NewsItem. Вызывается воркером раз в NEWS_POLL_MIN, в TronGrid не ходит.
 * Одна история из разных лент — одна запись: следующая лента добавляется в sources
 * и поднимает важность (подтверждение несколькими источниками). Дубли ищутся среди
 * новостей за последние 48 часов (тот же ключ или почти тот же заголовок).
 */
import { prisma } from "../db";
import { setState } from "../ingest";
import { classifyNews, isSameStory, newsKey, titleTokens } from "./classify";
import { parseFeed } from "./rss";
import { NEWS_SOURCES, type NewsSource } from "./sources";

/** Старше — не берём: при первом запуске не тащим архив лент. */
const MAX_AGE_MS = 48 * 3_600_000;
const FEED_TIMEOUT_MS = 15_000;
/** Подтверждение другими лентами поднимает важность, но не больше чем на 2. */
const MAX_CORROBORATION = 2;

export interface FeedStatus {
  id: string;
  name: string;
  ok: boolean;
  items: number;
  error?: string;
}

export interface NewsPollResult {
  created: number;
  merged: number;
  failed: string[];
  feeds: FeedStatus[];
}

async function fetchFeed(source: NewsSource): Promise<string> {
  const res = await fetch(source.url, {
    headers: {
      "user-agent": `TronFlow/1.0 (+${process.env.DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL || "self-hosted"})`,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const errorText = (err: unknown) =>
  err instanceof Error && err.name === "TimeoutError" ? "нет ответа за 15 с" : (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Только http(s): ссылка попадёт в href на странице и в Telegram. URL сам экранирует кавычки. */
function safeUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && u.href.length <= 1000 ? u.href : null;
  } catch {
    return null;
  }
}

export async function pollNews(opts: { fetch?: (s: NewsSource) => Promise<string>; now?: number } = {}): Promise<NewsPollResult> {
  const now = opts.now ?? Date.now();
  const load = opts.fetch ?? fetchFeed;
  const responses = await Promise.allSettled(NEWS_SOURCES.map((s) => load(s)));

  const known = (
    await prisma.newsItem.findMany({
      where: { publishedAt: { gte: new Date(now - MAX_AGE_MS) } },
      select: { id: true, key: true, title: true, sources: true, impact: true },
    })
  ).map((r) => ({ ...r, tokens: titleTokens(r.title) }));

  const feeds: FeedStatus[] = [];
  let created = 0;
  let merged = 0;

  for (const [i, source] of NEWS_SOURCES.entries()) {
    const res = responses[i];
    if (res.status === "rejected") {
      feeds.push({ id: source.id, name: source.name, ok: false, items: 0, error: errorText(res.reason) });
      continue;
    }
    const items = parseFeed(res.value);
    feeds.push({ id: source.id, name: source.name, ok: true, items: items.length });

    for (const item of items) {
      const publishedAt = Math.min(item.publishedAt ?? now, now);
      const url = safeUrl(item.url);
      const key = newsKey(item.title);
      if (now - publishedAt > MAX_AGE_MS || !url || !key) continue;

      const tokens = titleTokens(item.title);
      const same = known.find((k) => k.key === key || isSameStory(k.tokens, tokens));
      if (same) {
        if (!same.sources.includes(source.name)) {
          if (same.sources.length <= MAX_CORROBORATION) same.impact = Math.min(10, same.impact + 1);
          same.sources = [...same.sources, source.name];
          await prisma.newsItem.update({ where: { id: same.id }, data: { sources: same.sources, impact: same.impact } });
          merged++;
        }
        continue;
      }

      const c = classifyNews({ title: item.title, summary: item.summary, source });
      if (!c.relevant) continue;
      const row = await prisma.newsItem.create({
        data: {
          key,
          source: source.name,
          sources: [source.name],
          title: item.title.slice(0, 500),
          url,
          summary: item.summary || null,
          publishedAt: new Date(publishedAt),
          assets: c.assets,
          sentiment: c.sentiment,
          score: c.score,
          impact: c.impact,
          reasons: c.reasons,
        },
      });
      known.push({ id: row.id, key, title: row.title, sources: row.sources, impact: row.impact, tokens });
      created++;
    }
  }

  const failed = feeds.filter((f) => !f.ok).map((f) => f.name);
  await setState("news_status", JSON.stringify({ at: now, created, merged, feeds }));
  return { created, merged, failed, feeds };
}
