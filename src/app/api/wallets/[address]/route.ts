import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readJson, route, tagsToLabels, walletPatch } from "@/lib/api";

type Ctx = { params: Promise<{ address: string }> };

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { address } = await params;
  const { tags, autoTags, ...data } = await readJson(req, walletPatch);
  const wallet = await prisma.wallet.update({
    where: { address },
    data: {
      ...data,
      ...(tags !== undefined && { labels: { deleteMany: {}, create: tagsToLabels(tags, autoTags ?? []) } }),
    },
  });
  return NextResponse.json({ address: wallet.address });
});

/** Удаляет кошелёк из реестра. Переводы остаются: они же часть истории других кошельков. */
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { address } = await params;
  await prisma.wallet.delete({ where: { address } });
  return NextResponse.json({ ok: true });
});
