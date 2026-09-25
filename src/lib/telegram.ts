/**
 * Telegram Bot API без сторонних библиотек: для уведомлений нужны sendMessage,
 * getMe и getUpdates (поиск chat id). Токен — только в .env; chat id можно
 * задать в интерфейсе (хранится в AppSetting) или в .env.
 */
import { prisma } from "./db";

const API = "https://api.telegram.org";
const CHAT_SETTING = "telegram_chat_id";

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export async function telegramChatId(): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key: CHAT_SETTING } });
  return setting?.value || process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

export async function setTelegramChatId(chatId: string) {
  await prisma.appSetting.upsert({
    where: { key: CHAT_SETTING },
    create: { key: CHAT_SETTING, value: chatId },
    update: { value: chatId },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextSendAt = 0;

async function call<T>(method: string, body: Record<string, unknown>, token = telegramToken()): Promise<T> {
  if (!token) throw new TelegramError("Не задан TELEGRAM_BOT_TOKEN в .env");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (json.ok) return json.result as T;
    if (json.error_code === 429 && json.parameters?.retry_after) {
      await sleep((json.parameters.retry_after + 1) * 1000);
      continue;
    }
    throw new TelegramError(explain(json.error_code, json.description), json.error_code);
  }
  throw new TelegramError("Telegram ограничил частоту отправки, попробуйте позже", 429);
}

/** Понятные сообщения для типичных ошибок настройки. */
function explain(code?: number, description?: string) {
  if (code === 401) return "Токен бота неверный — проверьте TELEGRAM_BOT_TOKEN";
  if (code === 400 && description?.includes("chat not found")) return "Чат не найден: напишите боту /start или добавьте его в группу";
  if (code === 403) return "Бот не может писать в этот чат: его заблокировали или удалили из группы";
  return `Telegram: ${description ?? `ошибка ${code ?? "сети"}`}`;
}

/** Отправка с паузой ≥ 1,1 с между сообщениями (лимит Telegram ~1 сообщение в секунду на чат). */
export async function sendTelegram(html: string, chatId?: string | null) {
  const chat = chatId ?? (await telegramChatId());
  if (!chat) throw new TelegramError("Не выбран чат для уведомлений");
  const wait = nextSendAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextSendAt = Date.now() + 1100;
  await call("sendMessage", {
    chat_id: chat,
    text: html.length > 4000 ? html.slice(0, 3990) + "…" : html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function getBotInfo() {
  return call<{ username: string; first_name: string }>("getMe", {});
}

export interface DiscoveredChat {
  id: string;
  title: string;
  type: string;
}

/** Чаты, из которых боту недавно писали: так можно выбрать chat id, не вычисляя его вручную. */
export async function discoverChats(): Promise<DiscoveredChat[]> {
  const updates = await call<Array<Record<string, { chat?: { id: number; type: string; title?: string; username?: string; first_name?: string } }>>>(
    "getUpdates",
    { limit: 100, allowed_updates: ["message", "my_chat_member", "channel_post"] },
  );
  const chats = new Map<string, DiscoveredChat>();
  for (const u of updates) {
    for (const part of Object.values(u)) {
      const chat = typeof part === "object" && part ? part.chat : undefined;
      if (!chat) continue;
      chats.set(String(chat.id), {
        id: String(chat.id),
        type: chat.type,
        title: chat.title ?? (chat.username ? `@${chat.username}` : (chat.first_name ?? String(chat.id))),
      });
    }
  }
  return [...chats.values()];
}
