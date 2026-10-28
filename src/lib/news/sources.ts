/**
 * Бесплатные новостные ленты. weight — вклад источника в важность новости (1–3):
 * официальные ФРС и SEC весомее изданий. only — какие записи ленты вообще брать:
 * у ФРС и SEC большая часть релизов к рынку криптовалют отношения не имеет.
 */
export interface NewsSource {
  id: string;
  name: string;
  url: string;
  weight: number;
  only?: "crypto" | "monetary";
}

export const NEWS_SOURCES: NewsSource[] = [
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", weight: 2 },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml", weight: 2 },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", weight: 1 },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", weight: 1 },
  { id: "bitcoinmagazine", name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/.rss/full/", weight: 1 },
  { id: "cryptoslate", name: "CryptoSlate", url: "https://cryptoslate.com/feed/", weight: 1 },
  { id: "fed", name: "ФРС США", url: "https://www.federalreserve.gov/feeds/press_all.xml", weight: 3, only: "monetary" },
  { id: "sec", name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss", weight: 3, only: "crypto" },
];
