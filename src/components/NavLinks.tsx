"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, LayoutDashboard, Network, ScanSearch, Wallet } from "lucide-react";

const GROUPS = [
  {
    title: "Рынок",
    items: [
      { href: "/", label: "Обзор", icon: LayoutDashboard },
      { href: "/liquidity", label: "Ликвидность", icon: Activity },
      { href: "/graph", label: "Граф связей", icon: Network },
      { href: "/patterns", label: "Паттерны", icon: ScanSearch },
    ],
  },
  { title: "Реестр", items: [{ href: "/wallets", label: "Кошельки", icon: Wallet }] },
  { title: "Сигналы", items: [{ href: "/alerts", label: "Уведомления", icon: Bell }] },
];

export function NavLinks() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav aria-label="Разделы" className="flex gap-1 overflow-x-auto md:flex-col md:gap-5 md:overflow-visible">
      {GROUPS.map((g) => (
        <div key={g.title} className="flex gap-1 md:flex-col md:gap-0.5">
          <div className="text-muted hidden px-2 pb-1 text-xs md:block">{g.title}</div>
          {g.items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm whitespace-nowrap ${
                active(href) ? "bg-surface-2 text-fg font-medium" : "text-fg-2 hover:text-fg hover:bg-surface-2/60"
              }`}
            >
              <Icon size={16} strokeWidth={active(href) ? 2.2 : 1.8} aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
