import { HttpError } from "./util";

export async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<void> {
  const t = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, t + windowMs, t)
    .first<{ count: number; reset_at: number }>();
  if (row && row.count > limit) {
    const minutes = Math.max(1, Math.ceil((row.reset_at - t) / 60000));
    throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`, "rate_limited");
  }
}
