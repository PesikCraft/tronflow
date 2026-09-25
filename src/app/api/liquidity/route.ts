import { NextResponse } from "next/server";
import { getLiquidity, SERIES_RANGES, type SeriesRange } from "@/lib/liquidity";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Потоки 1/4/24 ч, давление на курс, скорость обращения, ряд для графика, кошельки-драйверы. */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const range = (q.get("range") ?? "48h") in SERIES_RANGES ? (q.get("range") as SeriesRange) : "48h";
  const data = await getLiquidity({
    scope: q.get("scope") === "all" ? "all" : "market",
    window: Number(q.get("window")) || 4,
    range,
  });
  return NextResponse.json(data);
});
