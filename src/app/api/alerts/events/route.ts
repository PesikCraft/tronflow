import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit")) || 50);
  const events = await prisma.alertEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { rule: { select: { name: true, type: true } } },
  });
  return NextResponse.json(events.map((e) => ({ ...e, id: String(e.id) })));
});
