import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Для внешнего мониторинга: жива ли БД и когда воркер последний раз отчитался. */
export const GET = route(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
    const status = await prisma.syncState.findUnique({ where: { key: "worker_status" } });
    const workerAt = status ? (JSON.parse(status.value) as { at: number }).at : null;
    const workerAlive = workerAt !== null && Date.now() - workerAt < 5 * 60_000;
    return NextResponse.json({ ok: workerAlive, db: true, workerAt }, { status: workerAlive ? 200 : 503 });
  },
  { public: true },
);
