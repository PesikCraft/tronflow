import { PERIODS, type Period } from "@/lib/analytics";
import { Segmented } from "./Segmented";

const LABEL: Record<Period, string> = { "1d": "Сутки", "7d": "7 дней", "30d": "30 дней", "90d": "90 дней" };

export function PeriodTabs({ current, basePath, extra = {} }: { current: Period; basePath: string; extra?: Record<string, string> }) {
  return (
    <Segmented
      label="Период"
      current={current}
      items={(Object.keys(PERIODS) as Period[]).map((p) => ({ key: p, label: LABEL[p] }))}
      href={(p) => `${basePath}?${new URLSearchParams({ ...extra, period: p })}`}
    />
  );
}
