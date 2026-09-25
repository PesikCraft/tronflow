import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import { isValidTronAddress } from "./tron/address";
import { CATEGORIES } from "./format";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Обёртка роутов: повторная проверка сессии (proxy — лишь первый рубеж),
 * единый формат ошибок. Внутренние ошибки логируются, клиенту — без деталей.
 */
export function route<C>(fn: (req: Request, ctx: C) => Promise<Response>, opts: { public?: boolean } = {}) {
  return async (req: Request, ctx: C) => {
    try {
      if (!opts.public && !verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") },
          { status: 400 },
        );
      }
      const code = (err as { code?: string }).code;
      if (code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
      console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", url: req.url, message: String(err) }));
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
  };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  return schema.parse(body);
}

export const tronAddress = z
  .string()
  .trim()
  .refine(isValidTronAddress, "невалидный TRON-адрес (проверьте контрольную сумму)");

export const walletInput = z.object({
  address: tronAddress,
  label: z.string().trim().min(1, "метка обязательна").max(120),
  category: z.enum(CATEGORIES).default("UNKNOWN"),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  /** метки, проставленные эвристиками графа (hub, splitter …) */
  autoTags: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
});

export const walletPatch = walletInput.omit({ address: true }).partial().extend({ isWatched: z.boolean().optional() });

/** Экранирование для CSV + защита от формул при открытии в Excel. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tagsToLabels(tags: string[], autoTags: string[]) {
  const all = [
    ...tags.map((name) => ({ name, source: "MANUAL" as const })),
    ...autoTags.filter((t) => !tags.includes(t)).map((name) => ({ name, source: "AUTO" as const })),
  ];
  return all.map(({ name, source }) => ({
    label: { connectOrCreate: { where: { name }, create: { name, source } } },
  }));
}
