import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/ingest";
import { route, tronAddress } from "@/lib/api";

/** «Раскрыть узел» графа: воркер подтянет переводы контрагента за 30 дней. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ address: string }> }) => {
  const address = tronAddress.parse((await params).address);
  const job = await enqueueJob("EXPAND", address);
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
});
