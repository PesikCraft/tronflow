import Link from "next/link";

/** Переключатель-сегменты на ссылках: состояние живёт в URL, страницу можно сохранить и переслать. */
export function Segmented({
  items,
  current,
  href,
  label,
}: {
  items: { key: string; label: string }[];
  current: string;
  href: (key: string) => string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="border-line bg-surface inline-flex max-w-full overflow-x-auto rounded-lg border p-0.5">
      {items.map((it) => (
        <Link
          key={it.key}
          href={href(it.key)}
          aria-current={it.key === current ? "page" : undefined}
          className={`rounded-md px-3 py-1 text-sm whitespace-nowrap ${
            it.key === current ? "bg-surface-2 text-fg font-medium" : "text-fg-2 hover:text-fg"
          }`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
