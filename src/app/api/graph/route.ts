import { NextResponse } from "next/server";
import { getGraphData, parsePeriod } from "@/lib/analytics";
import { route, tronAddress } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const focus = q.get("focus") ? tronAddress.parse(q.get("focus")) : undefined;
  const data = await getGraphData(parsePeriod(q.get("period"), "30d"), {
    minAmount: Math.max(0, Number(q.get("minAmount")) || 0),
    focus,
  });
  return NextResponse.json(data);
});
