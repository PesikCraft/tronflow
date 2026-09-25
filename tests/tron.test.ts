import { test } from "node:test";
import assert from "node:assert/strict";
import { abiEncodeAddress, base58ToHex, hexToBase58, isValidTronAddress } from "../src/lib/tron/address";
import { formatUnits, USDT_CONTRACT } from "../src/lib/tron/usdt";

test("base58 <-> hex round-trip for USDT contract", () => {
  const hex = base58ToHex(USDT_CONTRACT);
  assert.equal(hex, "41a614f803b6fd780986a42c78ec9c7f77e6ded13c");
  assert.equal(hexToBase58(hex), USDT_CONTRACT);
  assert.equal(hexToBase58("0x" + hex.slice(2)), USDT_CONTRACT, "event-style 0x + 20 bytes");
});

test("address validation", () => {
  assert.ok(isValidTronAddress(USDT_CONTRACT));
  assert.ok(!isValidTronAddress(USDT_CONTRACT.slice(0, -1) + "u"), "bad checksum");
  assert.ok(!isValidTronAddress("0xa614f803b6fd780986a42c78ec9c7f77e6ded13c"), "ethereum format");
  assert.ok(!isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6"), "too short");
  assert.ok(!isValidTronAddress(""));
});

test("ABI address encoding is 32 bytes, left-padded", () => {
  const enc = abiEncodeAddress(USDT_CONTRACT);
  assert.equal(enc.length, 64);
  assert.equal(enc, "000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c");
});

test("formatUnits keeps full precision", () => {
  assert.equal(formatUnits("1373510000"), "1373.51");
  assert.equal(formatUnits("1"), "0.000001");
  assert.equal(formatUnits("0"), "0");
  assert.equal(formatUnits(10n ** 18n), "1000000000000");
  assert.equal(formatUnits("123456789012345678"), "123456789012.345678");
});
