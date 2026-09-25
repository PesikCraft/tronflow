"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Не удалось войти");
      return;
    }
    const next = params.get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="display text-xl font-semibold">TRON Flow</h1>
        <p className="text-fg-2 mt-1.5 text-sm">Потоки USDT по вашей адресной книге. Вход только для администратора.</p>
      </div>
      {/* для менеджеров паролей: у формы есть «логин» */}
      <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
      <label className="block space-y-1.5">
        <span className="text-fg-2 text-sm">Пароль</span>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className="input w-full py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full justify-center py-2" disabled={busy || !password}>
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
        Войти
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
