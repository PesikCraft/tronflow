import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, parseFeed } from "../src/lib/news/rss";
import { classifyNews, detectAssets, isSameStory, maxUsd, newsKey, titleTokens } from "../src/lib/news/classify";
import { NEWS_SOURCES } from "../src/lib/news/sources";
import { newsMessage } from "../src/lib/alerts/messages";
import { describeRule } from "../src/lib/alerts/rules";

const outlet = NEWS_SOURCES.find((s) => s.id === "coindesk")!;
const fed = NEWS_SOURCES.find((s) => s.id === "fed")!;
const sec = NEWS_SOURCES.find((s) => s.id === "sec")!;
const classify = (title: string, summary = "", source = outlet) => classifyNews({ title, summary, source });

test("RSS: CDATA, entities, HTML in description, date", () => {
  const xml = `<rss><channel><title>Feed</title><item>
    <title><![CDATA[Bitcoin & Ether <b>rally</b>]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link>
    <description>&lt;p&gt;Price is &#36;70,000 &amp; rising&lt;/p&gt;</description>
    <pubDate>Wed, 28 Oct 2026 19:46:03 +0000</pubDate>
  </item></channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.title, "Bitcoin & Ether rally");
  assert.equal(item.url, "https://example.com/a?x=1&y=2");
  assert.equal(item.summary, "Price is $70,000 & rising");
  assert.equal(item.publishedAt, Date.UTC(2026, 9, 28, 19, 46, 3));
});

test("Atom: link href, published; channel title is not an item", () => {
  const xml = `<feed><title>Feed</title><entry><title type="html">SEC sues exchange</title>
    <link rel="self" href="https://example.com/self"/><link href="https://example.com/post"/>
    <published>2026-10-28T10:00:00Z</published><summary>Text</summary></entry></feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/post");
  assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 28, 10));
});

test("text with '<' is not mistaken for a tag", () => {
  assert.equal(cleanText("BTC &lt; $100k as ETH > $4k"), "BTC < $100k as ETH > $4k");
});

test("assets: tickers are case-sensitive, names are not", () => {
  assert.deepEqual(detectAssets("Solana and bitcoin rally"), ["BTC", "SOL"]);
  assert.deepEqual(detectAssets("The sol of the matter: link up"), []);
  assert.deepEqual(detectAssets("Fed holds rates"), ["MARKET"]);
});

test("direction: hacks and ETF outflows are bearish, ETF approval bullish", () => {
  assert.equal(classify("Exchange hacked, $120 million drained").sentiment, "BEARISH");
  assert.equal(classify("Bitcoin ETFs see $500M outflows").sentiment, "BEARISH");
  assert.equal(classify("SEC approves spot Solana ETF").sentiment, "BULLISH");
  assert.equal(classify("Bitcoin ETF inflows climb to $176M as BTC rebounds").sentiment, "BULLISH");
});

test("negation and denials do not count", () => {
  assert.notEqual(classify("Bitcoin fails to break above $80K").sentiment, "BULLISH");
  const denial = classify("Coinbase denies systems breach");
  assert.ok(!denial.reasons.includes("взлом"));
});

test("summary context does not flip a neutral headline", () => {
  const c = classify("Fed leaves interest rates unchanged, as expected", "Markets fear a rate hike and a crash later", fed);
  assert.equal(c.sentiment, "NEUTRAL");
  assert.ok(!c.reasons.includes("повышение ставки"));
});

test("impact: official source, topic, severe event and title amount raise it", () => {
  const fomc = classify("Federal Reserve issues FOMC statement", "Monetary policy statement", fed);
  assert.ok(fomc.relevant);
  assert.ok(fomc.impact >= 7, `FOMC impact ${fomc.impact}`);
  const hack = classify("Ethereum bridge hacked, $1.2 billion stolen");
  assert.ok(hack.impact >= 7, `hack impact ${hack.impact}`);
  assert.ok(hack.reasons.includes("$1.2 млрд"));
  const minor = classify("How to set up a wallet: a guide");
  assert.ok(minor.impact <= 2);
});

test("official feeds keep only relevant releases", () => {
  assert.equal(classify("Federal Reserve Board announces enforcement action against a bank", "", fed).relevant, false);
  assert.equal(classify("SEC charges investment adviser with fraud", "", sec).relevant, false);
  assert.equal(classify("SEC proposal addresses custody of crypto assets", "", sec).relevant, true);
});

test("amounts", () => {
  assert.equal(maxUsd("raised $1.2B after $500 million"), 1.2e9);
  assert.equal(maxUsd("price is $70,000"), 70_000);
});

test("same story across outlets", () => {
  const a = titleTokens("Strategy shareholders approve daily dividends for four preferred stocks");
  const b = titleTokens("Strategy (MSTR) Shareholders Approve Daily Dividends on Four Preferred Stocks");
  const c = titleTokens("Bitcoin ETF inflows climb to $176M as BTC rebounds above $80K");
  assert.ok(isSameStory(a, b));
  assert.ok(!isSameStory(a, c));
  assert.equal(newsKey("Bitcoin  Hits $100K!"), newsKey("bitcoin hits $100k"));
});

test("telegram message escapes title and links to the article", () => {
  const m = newsMessage(
    {
      title: "SEC <approves> ETF & more",
      url: "https://example.com/a?x=1&y=2",
      sources: ["CoinDesk", "The Block"],
      assets: ["BTC", "MARKET"],
      sentiment: "BULLISH",
      impact: 8,
      reasons: ["одобрение ETF"],
      publishedAt: new Date(Date.UTC(2026, 9, 28, 15, 46)),
    },
    "Важные",
    { dashboardUrl: "http://desk:3000" },
  );
  assert.match(m, /SEC &lt;approves&gt; ETF &amp; more/);
  assert.match(m, /href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
  assert.match(m, /важность 8\/10 · BTC, рынок/);
  assert.match(m, /28\.10, 19:46/);
  assert.match(m, /http:\/\/desk:3000\/news/);
  assert.match(describeRule("NEWS", { minImpact: 7, assets: ["BTC"] }), /важность от 7 из 10; BTC/);
});
