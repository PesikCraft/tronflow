/**
 * Авторизация одного администратора: пароль из .env, сессия — HMAC-подписанная
 * httpOnly-cookie `<expiresAt>.<signature>`. Хранилище сессий не нужно;
 * смена SESSION_SECRET мгновенно разлогинивает всех.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { authEnv } from "./env";

export const SESSION_COOKIE = "tf_session";

const sign = (payload: string) => createHmac("sha256", authEnv().SESSION_SECRET).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual требует равную длину; сравниваем хэши, чтобы не выдавать длину пароля
  const ha = createHmac("sha256", "cmp").update(ab).digest();
  const hb = createHmac("sha256", "cmp").update(bb).digest();
  return timingSafeEqual(ha, hb) && ab.length === bb.length;
}

export function checkPassword(candidate: string) {
  return safeEqual(candidate, authEnv().ADMIN_PASSWORD);
}

export function createSessionToken(): { token: string; maxAge: number } {
  const maxAge = authEnv().SESSION_TTL_HOURS * 3600;
  const expiresAt = String(Date.now() + maxAge * 1000);
  return { token: `${expiresAt}.${sign(expiresAt)}`, maxAge };
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAt, sig] = token.split(".");
  if (!expiresAt || !sig || !safeEqual(sig, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
}

// --- защита от перебора: 5 неудачных попыток за 15 минут на IP ---

const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export function isLockedOut(ip: string) {
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

export function registerFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

export function clearFailures(ip: string) {
  failures.delete(ip);
}
