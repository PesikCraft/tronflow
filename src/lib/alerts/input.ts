/** Валидация правила уведомления из API: общие поля + параметры по типу. */
import { z } from "zod";
import { tronAddress } from "../api";
import { CATEGORIES } from "../format";
import { ALERT_TYPES, paramsSchema } from "./rules";

export const ruleInput = z
  .object({
    type: z.enum(ALERT_TYPES),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    params: z.unknown(),
    categories: z.array(z.enum(CATEGORIES)).default([]),
    addresses: z.array(tronAddress).max(200).default([]),
    cooldownMin: z.coerce.number().int().min(0).max(24 * 60).default(60),
  })
  .transform((r, ctx) => {
    const p = paramsSchema[r.type].safeParse(r.params);
    if (!p.success) {
      for (const i of p.error.issues) ctx.addIssue({ code: "custom", path: ["params", ...i.path.map(String)], message: i.message });
      return z.NEVER;
    }
    return { ...r, params: p.data };
  });
