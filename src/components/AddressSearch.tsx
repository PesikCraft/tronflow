"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Адрес — сразу в карточку; текст — поиск по меткам в адресной книге. */
export function AddressSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (!v) return;
        router.push(TRON_ADDRESS.test(v) ? `/wallets/${v}` : `/wallets?q=${encodeURIComponent(v)}`);
        setQ("");
      }}
      className="relative"
    >
      <Search size={14} className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" aria-hidden />
      <input
        className="input w-full pl-8"
        placeholder="Адрес T… или метка"
        aria-label="Найти кошелёк по адресу или метке"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        spellCheck={false}
      />
    </form>
  );
}
