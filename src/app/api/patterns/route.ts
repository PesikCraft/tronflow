import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const type = q.get("type");
  const findings = await prisma.patternFinding.findMany({
    where: {
      ...(status === "NEW" || status === "APPLIED" || status === "DISMISSED" ? { status } : {}),
      ...(type === "FAN_OUT" || type === "FAN_IN" || type === "LOOP" ? { type } : {}),
    },
    orderBy: [{ score: "desc" }, { lastSeen: "desc" }],
    take: 300,
  });
  return NextResponse.json(findings);
});
