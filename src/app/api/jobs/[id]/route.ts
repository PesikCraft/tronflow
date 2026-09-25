import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: Number((await params).id) || 0 } });
  return NextResponse.json(job);
});
