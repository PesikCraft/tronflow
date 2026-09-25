import { NextResponse } from "next/server";
import { z } from "zod";
import { applyFinding, setFindingStatus } from "@/lib/patterns/scan";
import { readJson, route } from "@/lib/api";

/** apply — поставить метку на кошельки; dismiss — отклонить; reopen — вернуть в новые. */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = Number((await params).id);
  const { action } = await readJson(req, z.object({ action: z.enum(["apply", "dismiss", "reopen"]) }));
  const f = action === "apply" ? await applyFinding(id) : await setFindingStatus(id, action === "dismiss" ? "DISMISSED" : "NEW");
  return NextResponse.json({ id: f.id, status: f.status });
});
