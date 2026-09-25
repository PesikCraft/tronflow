import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { discoverChats, escapeHtml, getBotInfo, sendTelegram, setTelegramChatId, telegramChatId, telegramToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Состояние подключения: есть ли токен, какой бот, какой чат выбран. */
export const GET = route(async () => {
  const token = Boolean(telegramToken());
  const chatId = await telegramChatId();
  let bot: string | null = null;
  let error: string | null = null;
  if (token) {
    try {
      bot = (await getBotInfo()).username;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json({ token, bot, chatId, error, dashboardUrl: process.env.DASHBOARD_URL || process.env.RENDER_EXTERNAL_URL || null });
});

/** discover — чаты, где писали боту; select — выбрать чат; test — пробное сообщение. */
export const POST = route(async (req: Request) => {
  const body = await readJson(
    req,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("discover") }),
      z.object({ action: z.literal("select"), chatId: z.string().trim().regex(/^-?\d+$|^@\w{4,}$/, "chat id — число или @channel") }),
      z.object({ action: z.literal("test") }),
    ]),
  );
  try {
    if (body.action === "discover") return NextResponse.json({ chats: await discoverChats() });
    if (body.action === "select") {
      await setTelegramChatId(body.chatId);
      return NextResponse.json({ ok: true });
    }
    await sendTelegram(
      `✅ <b>TRON Flow подключён</b>\nСюда будут приходить уведомления о крупных переводах, всплесках объёма, новых адресах и паттернах.\n${escapeHtml(new Date().toLocaleString("ru-RU", { timeZone: "Asia/Yerevan" }))}`,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
