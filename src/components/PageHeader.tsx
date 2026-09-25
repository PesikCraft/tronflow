/** Заголовок страницы: название, одна строка пояснения и действия справа. */
export function PageHeader({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-xl font-semibold">{title}</h1>
        {lead && <p className="text-fg-2 mt-1.5 max-w-[70ch] text-sm">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
