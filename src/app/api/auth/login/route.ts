import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPassword, clearFailures, createSessionToken, isLockedOut, registerFailure, SESSION_COOKIE } from "@/lib/auth";
import { readJson, route } from "@/lib/api";

export const POST = route(
  async (req: Request) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    if (isLockedOut(ip)) {
      return NextResponse.json({ error: "Слишком много попыток. Подождите 15 минут." }, { status: 429 });
    }
    const { password } = await readJson(req, z.object({ password: z.string().max(200) }));
    if (!checkPassword(password)) {
      registerFailure(ip);
      await new Promise((r) => setTimeout(r, 500)); // замедляем перебор
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    clearFailures(ip);
    const { token, maxAge } = createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      // за прокси (Caddy на сервере) приложение видит http — смотрим на заголовок прокси
      secure: new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge,
    });
    return res;
  },
  { public: true },
);
