import { Hono } from "hono";
import { FEATURES } from "../shared/features";
import type { AppEnv, Env } from "./env";
import { button, esc, layout, sendMail } from "./lib/email";
import { checkHealth, refreshMeta } from "./lib/links";
import { HttpError, now, timingSafeEqual } from "./lib/util";
import { auth, loadSession } from "./routes/auth";
import { collections } from "./routes/collections";
import { links } from "./routes/links";
import { domains, img, me, publicView, sessions, shared, stats, tags, transfer } from "./routes/misc";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const allowed = [new URL(c.env.APP_URL).origin, new URL(c.req.url).origin];
    if (origin ? !allowed.includes(origin) : c.req.header("sec-fetch-site") === "cross-site") {
      throw new HttpError(403, "Permintaan dari situs lain ditolak", "csrf");
    }
  }
  await next();
  if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
});

// The free plan caps cron triggers per account, so background jobs also piggyback on regular traffic.
let lastJobCheck = 0;
app.use("*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/img") || Date.now() - lastJobCheck < 60_000) return;
  lastJobCheck = Date.now();
  c.executionCtx.waitUntil(
    claimJobs(c.env.DB, "jobs:auto", 10 * 60 * 1000)
      .then((claimed) => (claimed ? runJobs(c.env, LIGHT) : undefined))
      .catch((e) => console.error("auto jobs failed", e)),
  );
});

app.get("/jobs", async (c) => {
  const token = c.req.query("token") ?? c.req.header("x-job-token") ?? "";
  if (!c.env.JOB_TOKEN || !timingSafeEqual(token, c.env.JOB_TOKEN)) throw new HttpError(403, "Forbidden");
  if (!(await claimJobs(c.env.DB, "jobs:auto", 5 * 60 * 1000))) return c.json({ ok: true, skipped: true });
  c.executionCtx.waitUntil(runJobs(c.env, FULL));
  return c.json({ ok: true });
});

app.route("/auth", auth);
app.route("/img", img);
app.route("/public", publicView);
app.get("/health", (c) => c.json({ ok: true }));

app.use("*", async (c, next) => {
  const session = await loadSession(c);
  if (!session) throw new HttpError(401, "Sesi berakhir. Silakan masuk lagi.", "unauthorized");
  c.set("user", session.user);
  c.set("sessionHash", session.hash);
  await next();
});

app.route("/me", me);
app.route("/sessions", sessions);
app.route("/links", links);
app.route("/collections", collections);
app.route("/tags", tags);
app.route("/stats", stats);
app.route("/domains", domains);
app.route("/shared", shared);
app.route("/", transfer);

app.notFound((c) => c.json({ error: "Endpoint tidak ditemukan", code: "not_found" }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ ...err.data, error: err.message, code: err.code }, err.status as 400);
  console.error(err);
  return c.json({ error: "Terjadi kesalahan di server. Coba lagi.", code: "server_error" }, 500);
});

interface JobLimits {
  mails: number;
  meta: number;
  health: number;
}
// Free Workers allow 50 subrequests per invocation; LIGHT leaves room for the request that triggered it.
const LIGHT: JobLimits = { mails: 8, meta: 4, health: 2 };
const FULL: JobLimits = { mails: 20, meta: 12, health: 6 };

async function claimJobs(db: D1Database, key: string, intervalMs: number): Promise<boolean> {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET count = count + 1, reset_at = ?2 WHERE reset_at < ?3
       RETURNING key`,
    )
    .bind(key, t + intervalMs, t)
    .first();
  return !!row;
}

async function runJobs(env: Env, limits: JobLimits) {
  const jobs = [sendReminders(env, limits.mails), processMetadata(env, limits.meta), healthChecks(env, limits.health)];
  if (await claimJobs(env.DB, "jobs:cleanup", 6 * 60 * 60 * 1000)) jobs.push(cleanup(env));
  const results = await Promise.allSettled(jobs);
  results.forEach((x) => x.status === "rejected" && console.error("job failed", x.reason));
}

async function sendReminders(env: Env, maxMails: number) {
  if (!FEATURES.reminders) return;
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.url, l.title, l.domain, l.note, u.email, u.id AS user_id, u.settings FROM links l JOIN users u ON u.id = l.user_id
     WHERE l.remind_at IS NOT NULL AND l.remind_at <= ? AND l.reminded_at IS NULL AND l.deleted_at IS NULL
     ORDER BY l.user_id, l.remind_at LIMIT 200`,
  )
    .bind(t)
    .all<{ id: string; url: string; title: string | null; domain: string; note: string | null; email: string; user_id: string; settings: string }>();
  const byUser = new Map<string, typeof results>();
  for (const r of results) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let sent = 0;
  for (const list of byUser.values()) {
    if (sent >= maxMails) break;
    const settings = JSON.parse(list[0].settings || "{}");
    if (settings.digest !== false) {
      const items = list
        .map((l) => `<li style="margin:0 0 14px"><a href="${esc(l.url)}" style="color:#0f6b5c;font-weight:600">${esc(l.title || l.domain)}</a><br><span style="color:#8a847a;font-size:13px">${esc(l.domain)}</span>${l.note ? `<br><span style="font-size:14px">${esc(l.note.slice(0, 200))}</span>` : ""}</li>`)
        .join("");
      try {
        await sendMail(env, {
          to: list[0].email,
          subject: list.length === 1 ? `Pengingat: ${list[0].title || list[0].domain}` : `${list.length} link yang minta diingat`,
          text: list.map((l) => `- ${l.title || l.domain}\n  ${l.url}${l.note ? `\n  ${l.note.slice(0, 200)}` : ""}`).join("\n\n") + `\n\nBuka ${env.APP_URL}/?view=reminders`,
          html: layout(env, "Jangan lupa ini", `<ul style="padding-left:18px;margin:0 0 20px">${items}</ul>${button(`${env.APP_URL}/?view=reminders`, "Lihat semua pengingat")}`),
        });
        sent++;
      } catch (e) {
        console.error("reminder mail failed", e);
        continue;
      }
    }
    const ids = list.map((l) => l.id);
    await env.DB.prepare(`UPDATE links SET reminded_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(t, ...ids).run();
  }
}

async function processMetadata(env: Env, limit: number) {
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT id FROM links WHERE deleted_at IS NULL AND (
       status = 'pending' OR (status = 'failed' AND fetch_attempts < 3 AND coalesce(checked_at, 0) < ? - fetch_attempts * 1800000)
     ) ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(t, limit)
    .all<{ id: string }>();
  await Promise.all(results.map((r) => refreshMeta(env, r.id)));
}

async function healthChecks(env: Env, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT id, url FROM links WHERE deleted_at IS NULL AND status IN ('ok', 'broken') AND coalesce(checked_at, 0) < ?
     ORDER BY coalesce(checked_at, 0) LIMIT ?`,
  )
    .bind(now() - 7 * 24 * 60 * 60 * 1000, limit)
    .all<{ id: string; url: string }>();
  await Promise.all(results.map((r) => checkHealth(env, r.id, r.url)));
}

async function cleanup(env: Env) {
  const t = now();
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM links WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(t - 30 * 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(t - 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(t),
    db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM link_tags)"),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runJobs(env, FULL));
  },
} satisfies ExportedHandler<Env>;
