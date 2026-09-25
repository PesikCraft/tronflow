import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.SESSION_SECRET = "x".repeat(64);

const { checkPassword, createSessionToken, verifySessionToken, isLockedOut, registerFailure } = await import("../src/lib/auth");

test("password check", () => {
  assert.ok(checkPassword("correct-horse-battery"));
  assert.ok(!checkPassword("correct-horse-batter"));
  assert.ok(!checkPassword(""));
});

test("session token: valid, tampered, expired", () => {
  const { token } = createSessionToken();
  assert.ok(verifySessionToken(token));
  const [exp, sig] = token.split(".");
  assert.ok(!verifySessionToken(`${Number(exp) + 1000}.${sig}`), "extended expiry must fail signature");
  assert.ok(!verifySessionToken(`${exp}.${sig.slice(0, -2)}xx`));
  assert.ok(!verifySessionToken(undefined));
  assert.ok(!verifySessionToken("garbage"));
});

test("brute-force lockout after 5 failures", () => {
  const ip = "10.0.0.9";
  for (let i = 0; i < 5; i++) {
    assert.ok(!isLockedOut(ip));
    registerFailure(ip);
  }
  assert.ok(isLockedOut(ip));
});
