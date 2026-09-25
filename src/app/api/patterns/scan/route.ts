import { NextResponse } from "next/server";
import { z } from "zod";
import { scanAndStore } from "@/lib/patterns/scan";
import { readJson, route } from "@/lib/api";

/** Ручной скан (сканирует только базу, TronGrid не трогает). */
export const POST = route(async (req: Request) => {
  const { days } = await readJson(req, z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }));
  return NextResponse.json(await scanAndStore(days));
});
