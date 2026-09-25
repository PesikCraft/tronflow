"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";

interface Status {
  token: boolean;
  bot: string | null;
  chatId: string | null;
  error: string | null;
  dashboardUrl: string | null;
}

async function post(body: object) {
  const res = await fetch("/api/alerts/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-ink text-ink-fg" : "border-line-strong text-fg-2 border"}`}
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${done ? "text-fg-2" : ""}`}>{title}</div>
        {children && <div className="text-fg-2 mt-1.5 text-sm">{children}</div>}
      </div>
    </li>
  );
}

/** Подключение Telegram: шаги сквозные, каждый отмечается, когда выполнен. */
export function TelegramPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [chats, setChats] = useState<{ id: string; title: string; type: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => setS(await fetch("/api/alerts/telegram").then((r) => r.json())), []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <div className="card text-muted p-5 text-sm">Проверяем подключение…</div>;
  const tokenOk = s.token && !s.error;

  return (
    <section className="card min-w-0 p-5" aria-labelledby="tg-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tg-h" className="panel-title">
          Telegram
        </h2>
        {tokenOk && s.chatId ? (
          <span className="text-good flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle2 size={16} aria-hidden /> Уведомления уходят в чат
          </span>
        ) : (
          <span className="text-fg-2 flex items-center gap-1.5 text-sm">
            <XCircle size={16} aria-hidden /> Не подключён: сигналы пишутся только в журнал
          </span>
        )}
      </div>

      <ol className="mt-5 space-y-5">
        <Step n={1} done={s.token} title="Создайте бота и добавьте его токен">
          {!s.token ? (
            <>
              <p>
                В Telegram откройте @BotFather, отправьте <b>/newbot</b> и скопируйте токен. На Mac с платформой выполните в терминале,
                подставив свой токен:
              </p>
              <pre className="bg-surface-2 mt-2 overflow-x-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre">
                {`cd ~/tronflow\necho "TELEGRAM_BOT_TOKEN='123456:ABC…'" >> .env\nlaunchctl kickstart -k gui/$UID/com.tronflow.web\nlaunchctl kickstart -k gui/$UID/com.tronflow.worker`}
              </pre>
            </>
          ) : s.error ? (
            <p className="text-critical">{s.error}</p>
          ) : (
            <p>
              Бот <b className="text-fg">@{s.bot}</b> подключён.
            </p>
          )}
        </Step>

        <Step n={2} done={!!s.chatId} title="Выберите, куда слать уведомления">
          {tokenOk && (
            <>
              <p>
                Напишите боту <b>/start</b> в личке или добавьте его в рабочую группу и отправьте туда любое сообщение. Затем
                найдите чат здесь.
              </p>
              {s.chatId && (
                <p className="mt-1">
                  Сейчас выбран чат <span className="addr text-fg">{s.chatId}</span>.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() =>
                    act("discover", async () => {
                      const r = await post({ action: "discover" });
                      setChats(r.chats);
                      if (!r.chats.length) setMsg({ ok: false, text: "Боту пока никто не писал. Отправьте ему сообщение и нажмите ещё раз." });
                    })
                  }
                >
                  {busy === "discover" && <Loader2 size={14} className="animate-spin" aria-hidden />}
                  Найти чаты
                </button>
              </div>
              {chats && chats.length > 0 && (
                <ul className="border-line mt-3 divide-y divide-(--line) rounded-md border">
                  {chats.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">
                        <span className="text-fg">{c.title}</span>{" "}
                        <span className="text-muted text-xs">{c.type === "private" ? "личный чат" : c.type === "channel" ? "канал" : "группа"}</span>
                      </span>
                      <button
                        type="button"
                        className={c.id === s.chatId ? "btn" : "btn-primary"}
                        disabled={!!busy || c.id === s.chatId}
                        onClick={() =>
                          act("select", async () => {
                            await post({ action: "select", chatId: c.id });
                            await load();
                            setMsg({ ok: true, text: `Чат «${c.title}» выбран` });
                          })
                        }
                      >
                        {c.id === s.chatId ? "Выбран" : "Выбрать"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Step>

        <Step n={3} done={false} title="Проверьте доставку">
          {tokenOk && s.chatId && (
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() =>
                act("test", async () => {
                  await post({ action: "test" });
                  setMsg({ ok: true, text: "Тестовое сообщение отправлено — проверьте чат" });
                })
              }
            >
              {busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
              Отправить тестовое сообщение
            </button>
          )}
          {!s.dashboardUrl && (
            <p className="mt-2 text-xs">
              Чтобы ссылки из сообщений открывали дашборд, добавьте в .env адрес, по которому он доступен с телефона, например{" "}
              <span className="addr">DASHBOARD_URL=&apos;http://192.168.1.20:3000&apos;</span>. Без него ссылки ведут на Tronscan.
            </p>
          )}
        </Step>
      </ol>

      {msg && (
        <p role="status" className={`mt-4 text-sm ${msg.ok ? "text-good" : "text-critical"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
