import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Ctx, Env } from "../env";
import { isLocal } from "../env";
import { button, esc, layout, sendMail } from "../lib/email";
import { rateLimit } from "../lib/ratelimit";
import { seedDemo } from "../lib/demo";
import { HttpError, normalizeEmail, now, randomCode, randomToken, sha256, uid } from "../lib/util";

export const SESSION_COOKIE = "jl_session";
const TOKEN_TTL = 15 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

export function safeRedirect(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.length > 2000) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/auth/")) return "/";
  return raw;
}

function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";
}

async function createSession(c: Ctx, userId: string) {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256(token), userId, (c.req.header("user-agent") || "").slice(0, 300), t, t, t + SESSION_TTL)
    .run();
  setSessionCookie(c, token);
}

function setSessionCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.env.APP_URL.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL / 1000,
  });
}

async function signIn(c: Ctx, email: string) {
  const t = now();
  const db = c.env.DB;
  let user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (!user) {
    const id = uid();
    const res = await db.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(id, email, t).run();
    user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    // Only the request that actually created the account seeds the demo, so a double-submit can't add two.
    if (res.meta.changes) await seedDemo(c.env, user!.id).catch((e) => console.error("demo seed failed", e));
  }
  await db.batch([
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(t, user!.id),
    db.prepare("UPDATE login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(t, email),
    // Invites sent before this person had an account become active now.
    db.prepare("UPDATE collection_members SET user_id = ? WHERE email = ? AND user_id IS NULL").bind(user!.id, email),
    db.prepare("UPDATE link_shares SET user_id = ? WHERE email = ? AND user_id IS NULL").bind(user!.id, email),
  ]);
  await createSession(c, user!.id);
}

function loginMail(env: Env, link: string, code: string) {
  const text = `Masuk ke ${env.APP_NAME}\n\nBuka link ini (berlaku 15 menit, sekali pakai):\n${link}\n\nAtau ketik kode ini di perangkat yang sedang kamu pakai: ${code}\n\nKalau kamu tidak meminta email ini, abaikan saja.`;
  const html = layout(
    env,
    "Masuk ke akunmu",
    `<p style="margin:0 0 20px">Klik tombol di bawah untuk masuk. Link berlaku 15 menit dan hanya bisa dipakai sekali.</p>
<p style="margin:0 0 24px">${button(link, "Masuk sekarang")}</p>
<p style="margin:0 0 6px;color:#5c574f">Membuka email di perangkat lain? Ketik kode ini:</p>
<p style="margin:0 0 24px;font-size:28px;letter-spacing:6px;font-weight:700;font-family:ui-monospace,Menlo,monospace">${esc(code)}</p>
<p style="margin:0;color:#8a847a;font-size:13px">Kalau kamu tidak meminta email ini, abaikan saja. Akunmu tetap aman.</p>`,
  );
  return { subject: `Kode masuk ${env.APP_NAME}: ${code}`, text, html };
}

export const auth = new Hono<AppEnv>()
  .post("/request", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "Alamat email tidak valid", "invalid_email");
    await rateLimit(c.env.DB, `login:ip:${clientIp(c)}`, 20, 15 * 60 * 1000);
    await rateLimit(c.env.DB, `login:email:${email}`, 5, 15 * 60 * 1000);

    const token = randomToken();
    const code = randomCode();
    const id = uid();
    const t = now();
    await c.env.DB.prepare(
      "INSERT INTO login_tokens (id, email, token_hash, code_hash, redirect, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, email, await sha256(token), await sha256(`${email}:${code}`), safeRedirect(body.redirect), t, t + TOKEN_TTL)
      .run();

    const link = `${c.env.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    try {
      await sendMail(c.env, { to: email, ...loginMail(c.env, link, code) });
    } catch (e) {
      console.error("login mail failed", e);
      throw new HttpError(502, "Email gagal dikirim. Coba lagi sebentar lagi.", "mail_failed");
    }
    const dev = c.env.EMAIL_PROVIDER === "console" && isLocal(c.env) ? { devLink: link, devCode: code } : {};
    return c.json({ ok: true, email, ...dev });
  })
  .post("/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.token !== "string" || body.token.length < 20) throw new HttpError(400, "Link tidak valid", "invalid_token");
    const hash = await sha256(body.token);
    const t = now();
    const row = await c.env.DB.prepare(
      "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, redirect",
    )
      .bind(t, hash, t)
      .first<{ email: string; redirect: string | null }>();
    if (!row) {
      const old = await c.env.DB.prepare("SELECT used_at, expires_at FROM login_tokens WHERE token_hash = ?").bind(hash).first<{ used_at: number | null; expires_at: number }>();
      if (!old) throw new HttpError(400, "Link tidak dikenali. Minta link baru.", "invalid_token");
      if (old.used_at) throw new HttpError(410, "Link ini sudah dipakai. Minta link baru kalau belum berhasil masuk.", "used_token");
      throw new HttpError(410, "Link sudah kedaluwarsa. Minta link baru.", "expired_token");
    }
    await signIn(c, row.email);
    return c.json({ ok: true, redirect: safeRedirect(row.redirect) });
  })
  .post("/code", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
    if (!email || code.length !== 6) throw new HttpError(400, "Kode harus 6 digit", "invalid_code");
    await rateLimit(c.env.DB, `code:ip:${clientIp(c)}`, 30, 15 * 60 * 1000);
    const t = now();
    const row = await c.env.DB.prepare(
      "SELECT id, code_hash, attempts, redirect FROM login_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(email, t)
      .first<{ id: string; code_hash: string; attempts: number; redirect: string | null }>();
    if (!row) throw new HttpError(410, "Kode sudah kedaluwarsa. Minta kode baru.", "expired_token");
    if (row.attempts >= MAX_CODE_ATTEMPTS) throw new HttpError(429, "Terlalu banyak kode salah. Minta kode baru.", "too_many_attempts");
    if ((await sha256(`${email}:${code}`)) !== row.code_hash) {
      await c.env.DB.prepare("UPDATE login_tokens SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
      const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
      throw new HttpError(400, left > 0 ? `Kode salah. Sisa ${left} percobaan.` : "Kode salah. Minta kode baru.", "wrong_code");
    }
    const claimed = await c.env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING id").bind(t, row.id).first();
    if (!claimed) throw new HttpError(410, "Kode ini sudah dipakai.", "used_token");
    await signIn(c, email);
    return c.json({ ok: true, redirect: safeRedirect(row.redirect) });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(token)).run();
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

export async function loadSession(c: Ctx) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.settings, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, t)
    .first<{ id: string; email: string; name: string | null; settings: string; last_seen_at: number }>();
  if (!row) return null;
  if (t - row.last_seen_at > 60 * 60 * 1000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?").bind(t, t + SESSION_TTL, hash).run(),
    );
    setSessionCookie(c, token);
  }
  return { user: { id: row.id, email: row.email, name: row.name, settings: row.settings }, hash };
}
