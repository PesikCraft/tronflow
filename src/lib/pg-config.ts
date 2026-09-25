/**
 * Параметры подключения к Postgres для node-postgres.
 * Облачные базы (Supabase, Neon и т. п.) требуют TLS с сертификатом их собственного CA —
 * шифруем соединение, но цепочку не проверяем (иначе "self-signed certificate in certificate chain").
 * Локальный/докерный Postgres — без TLS, как раньше.
 */
export function pgConnection(url = process.env.DATABASE_URL ?? "") {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return { connectionString: url };
  }
  const cloud = /supabase\.(com|co)$|neon\.tech$|render\.com$/.test(host) || process.env.DATABASE_SSL === "no-verify";
  if (!cloud) return { connectionString: url };
  const u = new URL(url);
  u.searchParams.delete("sslmode"); // иначе параметр из строки перекрыл бы ssl ниже
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
}
