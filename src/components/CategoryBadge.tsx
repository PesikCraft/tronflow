import { AlertTriangle } from "lucide-react";
import { CATEGORY_LABEL, categoryVar } from "@/lib/format";

/** Цвет категории — только маркер, название всегда текстом. «Подозрительный» — статус: значок + красный. */
export function CategoryBadge({ category }: { category: string }) {
  if (category === "SUSPICIOUS") {
    return (
      <span className="text-critical inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap">
        <AlertTriangle size={12} aria-hidden /> Подозрительный
      </span>
    );
  }
  return (
    <span className="text-fg-2 inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: categoryVar(category) }} />
      {CATEGORY_LABEL[category] ?? category}
    </span>
  );
}
