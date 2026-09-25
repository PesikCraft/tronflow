import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readJson, route } from "@/lib/api";
import { describeRule } from "@/lib/alerts/rules";
import { ruleInput } from "@/lib/alerts/input";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const rules = await prisma.alertRule.findMany({
    orderBy: { id: "asc" },
    include: { _count: { select: { events: true } } },
  });
  const last = await prisma.alertEvent.groupBy({ by: ["ruleId"], _max: { createdAt: true } });
  const lastBy = new Map(last.map((l) => [l.ruleId, l._max.createdAt]));
  return NextResponse.json(
    rules.map((r) => ({
      ...r,
      description: describeRule(r.type, r.params),
      events: r._count.events,
      lastEventAt: lastBy.get(r.id) ?? null,
    })),
  );
});

export const POST = route(async (req: Request) => {
  const data = await readJson(req, ruleInput);
  const rule = await prisma.alertRule.create({ data: { ...data, params: data.params as object } });
  return NextResponse.json(rule, { status: 201 });
});
