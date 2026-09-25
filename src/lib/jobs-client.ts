/** Ставит задачу воркеру и ждёт её завершения (опрос /api/jobs/{id}). */
export async function runJob(url: string, timeoutMs = 10 * 60_000): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}` };
  const { jobId } = (await res.json()) as { jobId: number };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const job = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
    if (job.status === "DONE") return { ok: true };
    if (job.status === "FAILED") return { ok: false, error: job.error ?? "ошибка" };
  }
  return { ok: false, error: "Воркер не ответил вовремя — проверьте, что он запущен" };
}
