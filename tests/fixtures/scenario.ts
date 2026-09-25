/**
 * Тестовая фикстура: синтетический граф с заранее известными структурами (для проверки эвристик).
 * Адреса выдуманные (без валидной контрольной суммы) — к реальным кошелькам отношения не имеют.
 */
import type { FlowTransfer, WalletMeta } from "../../src/lib/graph/types";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function makeScenario(seed = 42) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const addr = () => "T" + Array.from({ length: 33 }, () => B58[Math.floor(rnd() * 58)]).join("");
  const now = Date.now();
  const transfers: FlowTransfer[] = [];
  let tx = 0;
  const send = (from: string, to: string, amount: number, hoursAgo = rnd() * 24 * 25) =>
    transfers.push({
      txHash: (tx++).toString(16).padStart(64, "0"),
      from,
      to,
      amount: Math.round(amount * 100) / 100,
      ts: now - hoursAgo * 3_600_000,
    });

  const otc = addr();
  const exch = addr();
  const trader = addr();
  const wallets: WalletMeta[] = [
    { address: otc, label: "OTC Desk A", category: "OTC", isWatched: true, usdtBalance: 184_000 },
    { address: exch, label: "Exchanger B", category: "EXCHANGE", isWatched: true, usdtBalance: 512_300 },
    { address: trader, label: "Trader C", category: "TRADER", isWatched: true, usdtBalance: 23_400 },
  ];

  // Обычный рынок: клиенты покупают/продают у обменников
  for (let i = 0; i < 14; i++) {
    const client = addr();
    const desk = rnd() < 0.5 ? otc : exch;
    for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
      if (rnd() < 0.5) send(client, desk, 500 + rnd() * 9_000);
      else send(desk, client, 500 + rnd() * 9_000);
    }
  }
  for (let k = 0; k < 6; k++) send(exch, otc, 20_000 + rnd() * 30_000); // ребалансировка ликвидности
  for (let k = 0; k < 4; k++) send(otc, trader, 5_000 + rnd() * 10_000);

  // Пирамида: 4 коллектора × 9 «вкладчиков» -> вершина -> обменник
  const apex = addr();
  wallets.push({ address: apex, label: "Apex", category: "SUSPICIOUS", isWatched: false, usdtBalance: 1_200 });
  for (let c = 0; c < 4; c++) {
    const collector = addr();
    let collected = 0;
    for (let i = 0; i < 9; i++) {
      const v = 100 + rnd() * 900;
      collected += v;
      send(addr(), collector, v);
    }
    send(collector, apex, collected * 0.95);
  }
  send(apex, exch, 14_000);

  // Расщепитель: крупный вход от трейдера -> 9 мелких адресов почти целиком
  const splitter = addr();
  send(trader, splitter, 45_000, 30);
  for (let i = 0; i < 9; i++) send(splitter, addr(), 4_900 + rnd() * 50, 29);

  // Транзит: деньги проходят через адрес без задержки
  const transit = addr();
  const sink = addr();
  send(otc, transit, 80_000, 12);
  send(transit, sink, 79_990, 11.9);

  // Кольцо: OTC -> X -> Y -> OTC
  const x = addr();
  const y = addr();
  send(otc, x, 30_000, 48);
  send(x, y, 29_950, 47);
  send(y, otc, 29_900, 46);

  // Выплаты: 15 адресов по ~1 000 USDT за 10 минут
  const payer = addr();
  send(exch, payer, 16_000, 6);
  for (let i = 0; i < 15; i++) send(payer, addr(), 1_000 + rnd() * 20, 5 - i * 0.01);

  // Раздача, растянутая на недели, — НЕ рассылка
  const slow = addr();
  send(trader, slow, 20_000, 400);
  for (let i = 0; i < 12; i++) send(slow, addr(), 1_000, 300 - i * 20);

  // Сбор мелочи: 45 переводов от 40 адресов, затем два крупных вывода
  const pool = addr();
  const payers = Array.from({ length: 40 }, addr);
  let pooled = 0;
  for (let i = 0; i < 45; i++) {
    const v = 20 + rnd() * 280;
    pooled += v;
    send(payers[i % 40], pool, v, 100 - i);
  }
  send(pool, exch, pooled * 0.5, 40);
  send(pool, exch, pooled * 0.45, 20);

  // Ложное кольцо №1: структура P→Q→R→P есть, но по времени деньги так не шли
  const p = addr(), q = addr(), r = addr();
  send(p, q, 10_000, 10);
  send(q, r, 9_900, 20);
  send(r, p, 9_800, 5);

  // Ложное кольцо №2: по времени верно, но дальше ушла копейка
  const a = addr(), b = addr(), c = addr();
  send(a, b, 30_000, 30);
  send(b, c, 1_000, 29);
  send(c, a, 900, 28);

  return {
    transfers,
    wallets,
    expected: { apex, splitter, transit, cycle: [otc, x, y], payer, slow, pool, fakeLoops: [[p, q, r], [a, b, c]] },
  };
}
