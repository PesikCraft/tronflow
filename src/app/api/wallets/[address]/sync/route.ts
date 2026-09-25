import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/ingest";
import { route } from "@/lib/api";

/** Ставит синхронизацию в очередь воркера; клиент опрашивает /api/jobs/{id}. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ address: string }> }) => {
  const { address } = await params;
  await prisma.wallet.findUniqueOrThrow({ where: { address } });
  const job = await enqueueJob("SYNC", address);
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
});
