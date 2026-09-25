import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readJson, route } from "@/lib/api";
import { ruleInput } from "@/lib/alerts/input";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const id = Number((await params).id);
  const body = await readJson(req, z.object({ enabled: z.boolean() }).or(ruleInput));
  const rule = await prisma.alertRule.update({
    where: { id },
    data: "type" in body ? { ...body, params: body.params as object } : { enabled: body.enabled },
  });
  return NextResponse.json(rule);
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  await prisma.alertRule.delete({ where: { id: Number((await params).id) } });
  return NextResponse.json({ ok: true });
});
