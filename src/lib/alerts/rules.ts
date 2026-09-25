/** Параметры правил уведомлений по типам — общая схема для API, интерфейса и движка. */
import { z } from "zod";

export const ALERT_TYPES = ["WHALE", "VOLUME_SPIKE", "NEW_COUNTERPARTY", "PATTERN"] as const;
export type AlertTypeName = (typeof ALERT_TYPES)[number];

export const PATTERN_TYPES = ["FAN_OUT", "FAN_IN", "LOOP"] as const;

export const paramsSchema = {
  WHALE: z.object({ minAmount: z.coerce.number().positive() }),
  NEW_COUNTERPARTY: z.object({ minAmount: z.coerce.number().min(0) }),
  VOLUME_SPIKE: z.object({
    windowMin: z.coerce.number().int().min(5).max(24 * 60),
    spikePct: z.coerce.number().min(10).max(10_000),
    minVolume: z.coerce.number().min(0),
    baselineDays: z.coerce.number().int().min(1).max(30),
  }),
  PATTERN: z.object({
    patternTypes: z.array(z.enum(PATTERN_TYPES)).min(1),
    minScore: z.coerce.number().min(0).max(1),
  }),
} as const;

export type RuleParams<T extends AlertTypeName> = z.infer<(typeof paramsSchema)[T]>;

export const DEFAULT_PARAMS: { [T in AlertTypeName]: RuleParams<T> } = {
  WHALE: { minAmount: 20_000 },
  NEW_COUNTERPARTY: { minAmount: 5_000 },
  VOLUME_SPIKE: { windowMin: 30, spikePct: 100, minVolume: 10_000, baselineDays: 7 },
  PATTERN: { patternTypes: ["FAN_OUT", "FAN_IN", "LOOP"], minScore: 0.6 },
};

export const TYPE_INFO: Record<AlertTypeName, { title: string; description: string }> = {
  WHALE: { title: "Крупный перевод", description: "Один перевод по отслеживаемым кошелькам больше порога." },
  VOLUME_SPIKE: {
    title: "Всплеск объёма",
    description: "Объём за последние N минут выше средней нормы такого же окна за прошлые дни.",
  },
  NEW_COUNTERPARTY: {
    title: "Новый адрес",
    description: "Первый перевод с адреса или на адрес, которого ещё не было в базе.",
  },
  PATTERN: { title: "Новый паттерн", description: "Скан нашёл рассылку, сбор мелочи или кольцо переводов." },
};

export function parseParams(type: AlertTypeName, params: unknown) {
  return paramsSchema[type].parse(params) as RuleParams<typeof type>;
}

/** Человекочитаемое описание условия — для списка правил и сообщений. */
export function describeRule(type: AlertTypeName, params: unknown): string {
  const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
  const p = paramsSchema[type].safeParse(params);
  if (!p.success) return "некорректные параметры";
  switch (type) {
    case "WHALE":
      return `перевод от ${n((p.data as RuleParams<"WHALE">).minAmount)} USDT`;
    case "NEW_COUNTERPARTY":
      return `новый адрес, перевод от ${n((p.data as RuleParams<"NEW_COUNTERPARTY">).minAmount)} USDT`;
    case "VOLUME_SPIKE": {
      const d = p.data as RuleParams<"VOLUME_SPIKE">;
      return `объём за ${d.windowMin} мин выше нормы за ${d.baselineDays} дн. на ${d.spikePct} % и не меньше ${n(d.minVolume)} USDT`;
    }
    case "PATTERN": {
      const d = p.data as RuleParams<"PATTERN">;
      const names = { FAN_OUT: "рассылка", FAN_IN: "сбор", LOOP: "кольцо" };
      return `${d.patternTypes.map((t) => names[t]).join(", ")}; уверенность от ${Math.round(d.minScore * 100)} %`;
    }
  }
}
