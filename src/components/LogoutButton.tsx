"use client";

import { LogOut } from "lucide-react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      className="text-fg-2 hover:text-fg hover:bg-surface-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      <LogOut size={16} aria-hidden />
      <span className={compact ? "sr-only" : ""}>Выйти</span>
    </button>
  );
}
