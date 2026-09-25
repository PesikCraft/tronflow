/**
 * TRON-адреса: base58check (T...) <-> hex (41 + 20 байт).
 * Без зависимостей: tronweb тянет ~мегабайты ради двух функций.
 */
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));
const TRON_PREFIX = 0x41;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

function base58Encode(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

function base58Decode(str: string): Buffer {
  let n = 0n;
  for (const c of str) {
    const v = ALPHABET_MAP.get(c);
    if (v === undefined) throw new Error(`Invalid base58 character "${c}"`);
    n = n * 58n + v;
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const leadingZeros = str.length - str.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(n === 0n ? "" : hex, "hex")]);
}

/** "0x…"/"41…"/20-байтный hex -> "T…" */
export function hexToBase58(hex: string): string {
  let h = hex.toLowerCase().replace(/^0x/, "");
  if (h.length === 40) h = "41" + h;
  if (h.length !== 42 || !h.startsWith("41")) throw new Error(`Not a TRON hex address: ${hex}`);
  const payload = Buffer.from(h, "hex");
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

/** "T…" -> "41" + 40 hex */
export function base58ToHex(address: string): string {
  const raw = base58Decode(address);
  if (raw.length !== 25) throw new Error(`Invalid TRON address length: ${address}`);
  const payload = raw.subarray(0, 21);
  const checksum = raw.subarray(21);
  if (!sha256(sha256(payload)).subarray(0, 4).equals(checksum)) {
    throw new Error(`Invalid TRON address checksum: ${address}`);
  }
  if (payload[0] !== TRON_PREFIX) throw new Error(`Not a mainnet TRON address: ${address}`);
  return payload.toString("hex");
}

export function isValidTronAddress(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  try {
    base58ToHex(address);
    return true;
  } catch {
    return false;
  }
}

/** ABI-кодирование address-аргумента: 20 байт, left-pad до 32. */
export function abiEncodeAddress(address: string): string {
  return base58ToHex(address).slice(2).padStart(64, "0");
}
