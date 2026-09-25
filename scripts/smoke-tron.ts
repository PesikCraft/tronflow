/**
 * Живая проверка TRON-модуля против mainnet TronGrid (БД не нужна).
 *   npm run smoke:tron [-- <адрес>]
 */
import "dotenv/config";
import { base58ToHex, hexToBase58, isValidTronAddress } from "../src/lib/tron/address";
import { TronGridClient } from "../src/lib/tron/client";
import { fetchAccountTransfers, fetchUsdtTransferEvents, getUsdtBalances, USDT_CONTRACT } from "../src/lib/tron/usdt";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error("ASSERT: " + msg);
  console.log("  ✓", msg);
};

async function main() {
  // Собственный клиент: скрипту не нужна БД и полный .env
  const apiKey = process.env.TRONGRID_API_KEY || undefined;
  const tg = new TronGridClient({ apiKey, rps: apiKey ? 5 : 0.9 });
  console.log(apiKey ? "с API-ключом" : "без API-ключа (1 запрос/с)");

  console.log("address codec");
  assert(hexToBase58(base58ToHex(USDT_CONTRACT)) === USDT_CONTRACT, "base58 <-> hex round-trip");
  assert(isValidTronAddress(USDT_CONTRACT), "valid address accepted");
  assert(!isValidTronAddress(USDT_CONTRACT.slice(0, -1) + "u"), "bad checksum rejected");

  console.log("contract events (firehose), last 2 minutes");
  const events = await fetchUsdtTransferEvents(tg, { since: Date.now() - 120_000, maxPages: 1 });
  assert(events.length > 0, `got ${events.length} Transfer events`);
  assert(events.every((e) => isValidTronAddress(e.from) && isValidTronAddress(e.to)), "hex -> base58 decoded");
  assert(events.every((e, i) => i === 0 || e.blockTimestamp >= events[i - 1].blockTimestamp), "ascending order");
  console.log("   sample:", events[0]);

  const target = process.argv[2] ?? events[0].to;
  console.log(`account transfers for ${target}, last 7 days`);
  const txs = await fetchAccountTransfers(tg, target, { since: Date.now() - 7 * 86_400_000, maxPages: 2 });
  assert(Array.isArray(txs), `got ${txs.length} transfers`);
  assert(txs.every((t) => t.from === target || t.to === target), "every transfer touches the address");
  if (txs[0]) console.log("   sample:", txs[0]);

  console.log("balances");
  const balances = await getUsdtBalances(tg, [target, events[0].from, USDT_CONTRACT], { includeTrx: true });
  console.table(balances);
  assert(balances.every((b) => b.usdt !== null), "all balances resolved");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
