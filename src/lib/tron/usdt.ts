/**
 * USDT TRC-20 на TRON: балансы и Transfer-ивенты через TronGrid.
 *
 *  getUsdtBalances()          — balanceOf() для списка адресов (constant call, без комиссий)
 *  fetchAccountTransfers()    — история переводов конкретного адреса (бэкфилл / опрос)
 *  fetchUsdtTransferEvents()  — «firehose»: все Transfer-ивенты контракта USDT по времени
 *
 * Все суммы возвращаются строкой в человекочитаемых единицах ("1234.5") —
 * без потери точности, пригодно для NUMERIC(38,6) в Postgres.
 */
import { abiEncodeAddress, hexToBase58 } from "./address";
import type { TronGridClient } from "./client";

export const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const USDT_DECIMALS = 6;
/** Адрес-«пустышка» для owner_address в constant-вызовах (аккаунт может не существовать). */
const CALLER = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

export interface UsdtTransfer {
  txHash: string;
  blockNumber?: number;
  /** ms since epoch */
  blockTimestamp: number;
  from: string;
  to: string;
  /** десятичная строка, 6 знаков после точки максимум */
  amount: string;
  /** есть только у ивентов контракта */
  eventIndex?: number;
}

export interface BalanceResult {
  address: string;
  usdt: string | null;
  trx?: string | null;
  error?: string;
}

/** Целое в минимальных единицах -> десятичная строка ("1373510000" -> "1373.51"). */
export function formatUnits(raw: bigint | string, decimals = USDT_DECIMALS): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

// ---------------------------------------------------------------------------
// Балансы
// ---------------------------------------------------------------------------

interface ConstantCallResponse {
  result?: { result?: boolean; message?: string };
  constant_result?: string[];
}

export async function getUsdtBalance(client: TronGridClient, address: string): Promise<string> {
  const res = await client.post<ConstantCallResponse>("/wallet/triggerconstantcontract", {
    owner_address: CALLER,
    contract_address: USDT_CONTRACT,
    function_selector: "balanceOf(address)",
    parameter: abiEncodeAddress(address),
    visible: true,
  });
  const hex = res.constant_result?.[0];
  if (!res.result?.result || !hex) {
    const msg = res.result?.message ? Buffer.from(res.result.message, "hex").toString() : "empty result";
    throw new Error(`balanceOf(${address}) failed: ${msg}`);
  }
  return formatUnits(BigInt("0x" + hex));
}

/** TRX-баланс (нужен, чтобы видеть, есть ли у кошелька «газ» на переводы). */
export async function getTrxBalance(client: TronGridClient, address: string): Promise<string> {
  const res = await client.post<{ balance?: number }>("/wallet/getaccount", { address, visible: true });
  return formatUnits(BigInt(res.balance ?? 0), 6); // неактивированный аккаунт -> {}
}

/**
 * Балансы для списка адресов. Ошибка по одному адресу не валит весь батч.
 * Параллелизм ограничен — реальный темп всё равно задаёт rate limiter клиента.
 */
export async function getUsdtBalances(
  client: TronGridClient,
  addresses: string[],
  opts: { includeTrx?: boolean; concurrency?: number } = {},
): Promise<BalanceResult[]> {
  const unique = [...new Set(addresses)];
  const results: BalanceResult[] = new Array(unique.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < unique.length) {
      const i = cursor++;
      const address = unique[i];
      try {
        const [usdt, trx] = await Promise.all([
          getUsdtBalance(client, address),
          opts.includeTrx ? getTrxBalance(client, address) : Promise.resolve(undefined),
        ]);
        results[i] = { address, usdt, trx };
      } catch (err) {
        results[i] = { address, usdt: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, unique.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// История переводов адреса: GET /v1/accounts/{address}/transactions/trc20
// ---------------------------------------------------------------------------

interface Trc20TxResponse {
  data: Array<{
    transaction_id: string;
    block_timestamp: number;
    from: string;
    to: string;
    type: string;
    value: string;
    token_info?: { address: string; decimals: number };
  }>;
  meta?: { fingerprint?: string };
}

export interface AccountTransfersQuery {
  /** включительно, ms или Date */
  since?: number | Date;
  until?: number | Date;
  direction?: "in" | "out" | "all";
  order?: "asc" | "desc";
  pageSize?: number; // max 200
  maxPages?: number;
}

/**
 * Постранично отдаёт USDT-переводы адреса (async generator — вызывающий код
 * может писать в БД по странице и двигать курсор, не держа всё в памяти).
 */
export async function* iterateAccountTransfers(
  client: TronGridClient,
  address: string,
  q: AccountTransfersQuery = {},
): AsyncGenerator<UsdtTransfer[]> {
  let fingerprint: string | undefined;
  const maxPages = q.maxPages ?? Infinity;

  for (let page = 0; page < maxPages; page++) {
    const res = await client.get<Trc20TxResponse>(`/v1/accounts/${address}/transactions/trc20`, {
      contract_address: USDT_CONTRACT,
      only_confirmed: true,
      limit: Math.min(q.pageSize ?? 200, 200),
      order_by: `block_timestamp,${q.order ?? "asc"}`,
      min_timestamp: q.since !== undefined ? +q.since : undefined,
      max_timestamp: q.until !== undefined ? +q.until : undefined,
      only_to: q.direction === "in" ? true : undefined,
      only_from: q.direction === "out" ? true : undefined,
      fingerprint,
    });

    const batch = (res.data ?? [])
      .filter((t) => t.type === "Transfer" && (t.token_info?.address ?? USDT_CONTRACT) === USDT_CONTRACT)
      .map<UsdtTransfer>((t) => ({
        txHash: t.transaction_id,
        blockTimestamp: t.block_timestamp,
        from: t.from,
        to: t.to,
        amount: formatUnits(t.value),
      }));

    if (batch.length) yield batch;
    fingerprint = res.meta?.fingerprint;
    if (!fingerprint || (res.data ?? []).length === 0) return;
  }
}

export async function fetchAccountTransfers(
  client: TronGridClient,
  address: string,
  q: AccountTransfersQuery = {},
): Promise<UsdtTransfer[]> {
  const all: UsdtTransfer[] = [];
  for await (const page of iterateAccountTransfers(client, address, q)) all.push(...page);
  return all;
}

// ---------------------------------------------------------------------------
// Firehose: GET /v1/contracts/{USDT}/events?event_name=Transfer
// ---------------------------------------------------------------------------

interface ContractEventsResponse {
  data: Array<{
    block_number: number;
    block_timestamp: number;
    event_index: number;
    event_name: string;
    transaction_id: string;
    result: { from: string; to: string; value: string };
  }>;
  meta?: { fingerprint?: string };
}

export interface ContractEventsQuery {
  since: number | Date;
  until?: number | Date;
  maxPages?: number;
  /** Отбор на лету — например, только ивенты, затрагивающие отслеживаемые адреса. */
  filter?: (t: UsdtTransfer) => boolean;
}

export interface ContractEventsPage {
  transfers: UsdtTransfer[];
  /** block_timestamp последнего просмотренного ивента (для курсора), даже если filter всё отсеял */
  lastTimestamp: number | null;
  scanned: number;
  done: boolean;
}

/**
 * Последние Transfer-ивенты контракта USDT начиная с `since` (по возрастанию времени).
 *
 * Масштаб: USDT на TRON — порядка 2–3 млн переводов в сутки (~30/сек), т.е.
 * ~150 страниц по 200 ивентов в час. Это дешевле, чем опрашивать сотни
 * адресов по отдельности, и стоимость не растёт с размером адресной книги.
 */
export async function* iterateUsdtTransferEvents(
  client: TronGridClient,
  q: ContractEventsQuery,
): AsyncGenerator<ContractEventsPage> {
  let fingerprint: string | undefined;
  const maxPages = q.maxPages ?? Infinity;

  for (let page = 0; page < maxPages; page++) {
    const res = await client.get<ContractEventsResponse>(`/v1/contracts/${USDT_CONTRACT}/events`, {
      event_name: "Transfer",
      only_confirmed: true,
      order_by: "block_timestamp,asc",
      min_block_timestamp: +q.since,
      max_block_timestamp: q.until !== undefined ? +q.until : undefined,
      limit: 200,
      fingerprint,
    });

    const data = res.data ?? [];
    const transfers: UsdtTransfer[] = [];
    for (const e of data) {
      if (e.event_name !== "Transfer") continue;
      const t: UsdtTransfer = {
        txHash: e.transaction_id,
        blockNumber: e.block_number,
        blockTimestamp: e.block_timestamp,
        eventIndex: e.event_index,
        from: hexToBase58(e.result.from),
        to: hexToBase58(e.result.to),
        amount: formatUnits(e.result.value),
      };
      if (!q.filter || q.filter(t)) transfers.push(t);
    }

    fingerprint = res.meta?.fingerprint;
    const done = !fingerprint || data.length === 0;
    yield {
      transfers,
      lastTimestamp: data.length ? data[data.length - 1].block_timestamp : null,
      scanned: data.length,
      done,
    };
    if (done) return;
  }
}

export async function fetchUsdtTransferEvents(
  client: TronGridClient,
  q: ContractEventsQuery,
): Promise<UsdtTransfer[]> {
  const all: UsdtTransfer[] = [];
  for await (const page of iterateUsdtTransferEvents(client, q)) all.push(...page.transfers);
  return all;
}
