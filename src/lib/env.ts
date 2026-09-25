/**
 * Конфигурация из окружения с проверкой при старте: лучше упасть сразу
 * с понятной ошибкой, чем молча работать с пустым ключом или паролем.
 */
import { z } from "zod";

const num = (def: number) => z.coerce.number().positive().default(def);

const coreSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "DATABASE_URL должен быть postgres://…"),
  TRONGRID_URL: z.string().url().default("https://api.trongrid.io"),
  TRONGRID_API_KEY: z.string().default(""),
  TRONGRID_RPS: num(10),
  /** Бесплатный тариф — 100k/сутки; оставляем запас. При превышении воркер отключает второстепенные задачи. */
  TRONGRID_DAILY_BUDGET: num(90_000),
  INGEST_MODE: z.enum(["firehose", "poll"]).default("firehose"),
  WORKER_TICK_SEC: num(15),
  POLL_INTERVAL_SEC: num(120),
  BALANCE_SWEEP_HOURS: num(6),
  BACKFILL_DAYS: num(30),
  BACKFILL_MAX_PAGES: num(100),
  ANALYTICS_TZ: z.string().default("Asia/Yerevan"),
  /** Скан паттернов: как часто и за сколько дней */
  PATTERN_SCAN_MIN: num(60),
  PATTERN_SCAN_DAYS: num(7),
  /** Адрес дашборда для ссылок в Telegram, например http://192.168.1.20:3000 */
  DASHBOARD_URL: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  /** Хранить переводы N дней (0 — бессрочно). На бесплатной базе 500 МБ — 30. */
  TRANSFER_RETENTION_DAYS: z.coerce.number().min(0).default(0),
  /** Лимит размера базы для предупреждения в интерфейсе, МБ (0 — не следить) */
  DB_SIZE_LIMIT_MB: z.coerce.number().min(0).default(0),
  /** Адрес, который воркер пингует, чтобы бесплатный хостинг не усыплял сервис (на Render — сам) */
  KEEPALIVE_URL: z.string().default(""),
});

const authSchema = z.object({
  ADMIN_PASSWORD: z.string().min(10, "ADMIN_PASSWORD — минимум 10 символов"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET — минимум 32 символа (openssl rand -hex 32)"),
  SESSION_TTL_HOURS: num(24 * 7),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type AuthEnv = z.infer<typeof authSchema>;

function parse<T extends z.ZodType>(schema: T): z.infer<T> {
  const res = schema.safeParse(process.env);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Некорректная конфигурация .env:\n${issues}`);
  }
  return res.data;
}

let core: CoreEnv | undefined;
let auth: AuthEnv | undefined;

export const env = () => (core ??= parse(coreSchema));
export const authEnv = () => (auth ??= parse(authSchema));
