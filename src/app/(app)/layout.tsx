import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { AddressSearch } from "@/components/AddressSearch";
import { LiveStatus } from "@/components/LiveStatus";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "@/components/NavLinks";

function Wordmark() {
  return (
    <div className="flex items-center gap-2 px-2">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <circle cx="9" cy="10" r="4" fill="var(--flow-out)" />
        <circle cx="23" cy="9" r="3.4" fill="var(--brand)" />
        <circle cx="16" cy="23" r="4.6" fill="var(--flow-in)" />
        <path d="M11.8 13 14.6 19.4M20.8 11.6 17.8 19.2M12.9 9.8l6.9-.6" stroke="var(--fg-2)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="display text-base font-semibold">TRON Flow</span>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Проверка на сервере, помимо proxy: страницы с данными не рендерятся без сессии.
  if (!verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="border-line bg-surface flex flex-col gap-3 border-b px-3 py-3 md:sticky md:top-0 md:h-screen md:gap-6 md:border-r md:border-b-0 md:py-5">
        <div className="flex items-center justify-between gap-3">
          <Wordmark />
          <div className="md:hidden">
            <LogoutButton compact />
          </div>
        </div>
        <div className="hidden md:block">
          <AddressSearch />
        </div>
        <NavLinks />
        <div className="mt-auto hidden flex-col gap-3 md:flex">
          <LiveStatus />
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
