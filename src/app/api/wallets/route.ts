import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readJson, route, tagsToLabels, walletInput } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const all = new URL(req.url).searchParams.get("all") === "1";
  const wallets = await prisma.wallet.findMany({
    where: all ? {} : { isWatched: true },
    orderBy: [{ category: "asc" }, { label: "asc" }],
    include: { labels: { include: { label: true } } },
  });
  return NextResponse.json(
    wallets.map((w) => ({
      address: w.address,
      label: w.label,
      category: w.category,
      notes: w.notes,
      isWatched: w.isWatched,
      usdtBalance: w.usdtBalance == null ? null : Number(w.usdtBalance),
      trxBalance: w.trxBalance == null ? null : Number(w.trxBalance),
      balanceUpdatedAt: w.balanceUpdatedAt,
      lastSyncedAt: w.lastSyncedAt,
      backfilledAt: w.backfilledAt,
      historyFrom: w.historyFrom,
      syncError: w.syncError,
      tags: w.labels.map((l) => ({ name: l.label.name, source: l.label.source })),
      createdAt: w.createdAt,
    })),
  );
});

/**
 * Одиночное добавление или массовый импорт ({ items: [...] }).
 * При импорте невалидные строки не блокируют остальные — ошибки возвращаются построчно.
 * Если адрес уже есть (например, раскрытый контрагент) — он становится отслеживаемым.
 * История и баланс подтянутся воркером на ближайшем тике.
 */
export const POST = route(async (req: Request) => {
  const body = await readJson(req, z.union([z.object({ items: z.array(z.unknown()).min(1).max(1000) }), walletInput]));
  const single = !("items" in body);
  const raw = "items" in body ? body.items : [body];

  const results: { address: string; created: boolean }[] = [];
  const errors: { index: number; error: string }[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = walletInput.safeParse(item);
    if (!parsed.success) {
      errors.push({ index, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    const { address, label, category, notes, tags, autoTags } = parsed.data;
    const labels = tagsToLabels(tags, autoTags);
    const existing = await prisma.wallet.findUnique({ where: { address } });
    if (existing) {
      await prisma.wallet.update({
        where: { address },
        data: { label, category, notes, isWatched: true, labels: { deleteMany: {}, create: labels } },
      });
    } else {
      await prisma.wallet.create({ data: { address, label, category, notes, labels: { create: labels } } });
    }
    results.push({ address, created: !existing });
  }
  return NextResponse.json({ results, errors }, { status: single ? 201 : 200 });
});
