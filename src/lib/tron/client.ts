/**
 * Тонкий HTTP-клиент TronGrid: rate limit, таймауты, ретраи с backoff.
 *
 * Лимиты TronGrid: без ключа — 1 запрос/с (превышение = 429 и блокировка на ~5 с);
 * с ключом (заголовок TRON-PRO-API-KEY) — ~15 RPS и 100k запросов/сутки на free-тарифе.
 */
import { env } from "../env";

export interface TronGridOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Максимум запросов в секунду (общий на инстанс клиента). */
  rps?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export class TronGridError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "TronGridError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TronGridClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private nextSlot = 0;
  /** Счётчик HTTP-запросов (включая ретраи) — для учёта суточного лимита TronGrid. */
  requests = 0;

  constructor(opts: TronGridOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.trongrid.io").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.minIntervalMs = 1000 / (opts.rps ?? (opts.apiKey ? 10 : 0.9));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 6;
  }

  get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return this.request<T>(url, { method: "GET" });
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(new URL(this.baseUrl + path), {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Равномерно раздаёт «слоты» запросам — работает и при параллельных вызовах. */
  private async throttle() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body) headers["content-type"] = "application/json";
    if (this.apiKey) headers["TRON-PRO-API-KEY"] = this.apiKey;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle();
      this.requests++;
      try {
        const res = await fetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();

        if (res.ok) {
          const json = JSON.parse(text) as T & { success?: boolean; error?: string };
          // v1-эндпоинты иногда отвечают 200 + success:false
          if (json && json.success === false) {
            throw new TronGridError(`TronGrid error: ${json.error ?? text.slice(0, 200)}`, res.status, text);
          }
          return json;
        }

        lastError = new TronGridError(`HTTP ${res.status} ${url.pathname}`, res.status, text.slice(0, 500));
        if (res.status === 429) {
          // TronGrid «замораживает» клиента на N секунд: "...the query server is suspended for 5 s".
          // Пауза применяется ко всем запросам процесса через общий слот, а не только к этому.
          const suspended = Number(/suspended for (\d+)\s*s/i.exec(text)?.[1]);
          const retryAfter = Number(res.headers.get("retry-after"));
          const pause =
            suspended > 0 ? (suspended + 1) * 1000 : retryAfter > 0 ? retryAfter * 1000 : Math.max(2000, backoff(attempt));
          this.nextSlot = Math.max(this.nextSlot, Date.now() + pause);
          continue;
        }
        if (res.status < 500) throw lastError;
        await sleep(backoff(attempt));
      } catch (err) {
        if (err instanceof TronGridError && err.status && err.status < 500 && err.status !== 429) throw err;
        lastError = err;
        if (attempt < this.maxRetries) await sleep(backoff(attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new TronGridError(String(lastError));
  }
}

function backoff(attempt: number) {
  return Math.min(30_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

let shared: TronGridClient | undefined;

/** Клиент из конфигурации (один на процесс — общий rate limit). */
export function getTronGrid(): TronGridClient {
  if (!shared) {
    const e = env();
    shared = new TronGridClient({
      baseUrl: e.TRONGRID_URL,
      apiKey: e.TRONGRID_API_KEY || undefined,
      // Без ключа TronGrid пропускает 1 запрос/с и за превышение блокирует на несколько секунд
      rps: e.TRONGRID_API_KEY ? e.TRONGRID_RPS : 0.9,
    });
  }
  return shared;
}
