import { Hono } from "hono";
import type { AppEnv } from "../env";
import { secretOf } from "../env";
import { collectionRoles, syncFts, syncFtsForTag, toLinks, type LinkRow } from "../lib/links";
import { safeFetch } from "../lib/meta";
import { extractUrls, parseUserUrl } from "../lib/url";
import { HttpError, clampText, hmac, normalizeTag, now, timingSafeEqual } from "../lib/util";
import { FORGOTTEN_AFTER, insertMany, type IncomingLink } from "./links";

export const me = new Hono<AppEnv>()
  .get("/", (c) => {
    const u = c.get("user");
    return c.json({ id: u.id, email: u.email, name: u.name, settings: JSON.parse(u.settings || "{}") });
  })
  .patch("/", async (c) => {
    const u = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const settings = { ...JSON.parse(u.settings || "{}") };
    if (body.settings && typeof body.settings === "object") {
      const s = body.settings;
      if (["system", "light", "dark"].includes(s.theme)) settings.theme = s.theme;
      if (["grid", "list", "compact"].includes(s.view)) settings.view = s.view;
      if (typeof s.digest === "boolean") settings.digest = s.digest;
    }
    const name = "name" in body ? clampText(body.name, 80) : u.name;
    await c.env.DB.prepare("UPDATE users SET name = ?, settings = ? WHERE id = ?").bind(name, JSON.stringify(settings), u.id).run();
    return c.json({ id: u.id, email: u.email, name, settings });
  })
  .delete("/", async (c) => {
    const u = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    if (body.confirm !== u.email) throw new HttpError(400, "Ketik emailmu untuk konfirmasi");
    const db = c.env.DB;
    await db.batch([
      db.prepare("DELETE FROM links_fts WHERE rowid IN (SELECT rid FROM links WHERE user_id = ?)").bind(u.id),
      db.prepare("UPDATE links SET collection_id = NULL WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)").bind(u.id),
      db.prepare("DELETE FROM collection_members WHERE email = ?").bind(u.email),
      db.prepare("DELETE FROM link_shares WHERE email = ?").bind(u.email),
      db.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
    ]);
    return c.json({ ok: true });
  });

export const sessions = new Hono<AppEnv>()
  .get("/", async (c) => {
    const current = c.get("sessionHash");
    const { results } = await c.env.DB.prepare("SELECT id_hash, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC")
      .bind(c.get("user").id, now())
      .all<{ id_hash: string; user_agent: string; created_at: number; last_seen_at: number }>();
    return c.json({
      items: results.map((s) => ({ id: s.id_hash.slice(0, 16), userAgent: s.user_agent, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id_hash === current })),
    });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const uid = c.get("user").id;
    if (id === "others") {
      await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").bind(uid, c.get("sessionHash")).run();
    } else {
      await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id_hash, 1, 16) = ?").bind(uid, id).run();
    }
    return c.json({ ok: true });
  });

export const tags = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.name, COUNT(l.id) AS count FROM tags t
       LEFT JOIN link_tags lt ON lt.tag_id = t.id
       LEFT JOIN links l ON l.id = lt.link_id AND l.deleted_at IS NULL
       WHERE t.user_id = ? GROUP BY t.id HAVING count > 0 ORDER BY count DESC, t.name`,
    )
      .bind(c.get("user").id)
      .all();
    return c.json({ items: results });
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? normalizeTag(body.name) : null;
    if (!name) throw new HttpError(400, "Nama tag tidak valid");
    const db = c.env.DB;
    const target = await db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?").bind(user.id, name, id).first<{ id: string }>();
    if (target) {
      // Renaming onto an existing tag merges them.
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) SELECT link_id, ? FROM link_tags WHERE tag_id = ?").bind(target.id, id),
        db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").bind(id, user.id),
      ]);
      await syncFtsForTag(db, target.id);
      return c.json({ ok: true, merged: true });
    }
    await db.prepare("UPDATE tags SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, user.id).run();
    await syncFtsForTag(db, id);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const db = c.env.DB;
    const id = c.req.param("id");
    const { results } = await db.prepare("SELECT link_id FROM link_tags WHERE tag_id = ?").bind(id).all<{ link_id: string }>();
    await db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").bind(id, c.get("user").id).run();
    await syncFts(db, results.map((r) => r.link_id));
    return c.json({ ok: true });
  });

export const stats = new Hono<AppEnv>().get("/", async (c) => {
  const t = now();
  const row = await c.env.DB.prepare(
    `SELECT
       SUM(deleted_at IS NULL AND archived_at IS NULL) AS total,
       SUM(deleted_at IS NULL AND archived_at IS NULL AND read_at IS NULL) AS unread,
       SUM(deleted_at IS NULL AND archived_at IS NULL AND pinned = 1) AS pinned,
       SUM(deleted_at IS NULL AND remind_at IS NOT NULL) AS reminders,
       SUM(deleted_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ?2) AS due,
       SUM(deleted_at IS NULL AND status = 'broken') AS broken,
       SUM(deleted_at IS NULL AND archived_at IS NOT NULL) AS archived,
       SUM(deleted_at IS NOT NULL) AS trash,
       SUM(deleted_at IS NULL AND archived_at IS NULL AND open_count = 0 AND created_at < ?3) AS forgotten,
       SUM(deleted_at IS NULL AND collection_id IS NULL AND archived_at IS NULL) AS unsorted,
       (SELECT COUNT(*) FROM link_shares s JOIN links x ON x.id = s.link_id WHERE s.user_id = ?1 AND x.deleted_at IS NULL) AS shared,
       (SELECT COUNT(*) FROM link_shares s JOIN links x ON x.id = s.link_id WHERE s.user_id = ?1 AND s.seen_at IS NULL AND x.deleted_at IS NULL)
         + (SELECT COUNT(*) FROM collection_members WHERE user_id = ?1 AND seen_at IS NULL) AS shared_new
     FROM links WHERE user_id = ?1`,
  )
    .bind(c.get("user").id, t, t - FORGOTTEN_AFTER)
    .first<Record<string, number | null>>();
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row ?? {})) out[k] = v ?? 0;
  return c.json(out);
});

export const shared = new Hono<AppEnv>().post("/seen", async (c) => {
  const db = c.env.DB;
  const id = c.get("user").id;
  const t = now();
  await db.batch([
    db.prepare("UPDATE link_shares SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL").bind(t, id),
    db.prepare("UPDATE collection_members SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL").bind(t, id),
  ]);
  return c.json({ ok: true });
});

export const domains = new Hono<AppEnv>().get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT domain, COUNT(*) AS count FROM links WHERE user_id = ? AND deleted_at IS NULL GROUP BY domain ORDER BY count DESC LIMIT 30",
  )
    .bind(c.get("user").id)
    .all();
  return c.json({ items: results });
});

function parseNetscape(html: string): IncomingLink[] {
  const out: IncomingLink[] = [];
  const folders: string[] = [];
  const tokens = html.match(/<DT><H3[^>]*>[\s\S]*?<\/H3>|<\/DL>|<DT><A [^>]*>[\s\S]*?<\/A>(?:\s*<DD>[^<]*)?/gi) ?? [];
  for (const tok of tokens) {
    if (/^<DT><H3/i.test(tok)) {
      folders.push(decode(tok.replace(/<[^>]+>/g, "")).trim());
    } else if (/^<\/DL>/i.test(tok)) {
      folders.pop();
    } else {
      const href = tok.match(/HREF="([^"]*)"/i)?.[1];
      const url = href ? parseUserUrl(decode(href)) : null;
      if (!url) continue;
      const title = decode(tok.match(/<A [^>]*>([\s\S]*?)<\/A>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? "");
      const added = parseInt(tok.match(/ADD_DATE="(\d+)"/i)?.[1] ?? "0", 10);
      const tagAttr = tok.match(/TAGS="([^"]*)"/i)?.[1];
      const note = tok.match(/<DD>([^<]*)/i)?.[1];
      const folderTags = folders.filter((f) => f && !/^(bookmarks( bar| menu| toolbar)?|other bookmarks|favorites bar|mobile bookmarks|bilah bookmark|bookmark lainnya)$/i.test(f));
      out.push({
        url,
        title,
        note: note ? decode(note).trim() : null,
        createdAt: added ? (added > 1e12 ? added : added * 1000) : undefined,
        tags: [...folderTags, ...(tagAttr ? decode(tagAttr).split(",") : [])].map((t) => t.trim()).filter(Boolean).slice(0, 10),
      });
    }
  }
  return out;
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export const transfer = new Hono<AppEnv>()
  .post("/import", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "Pilih file bookmark (.html atau .json)");
    if (file.size > 10 * 1024 * 1024) throw new HttpError(400, "File maksimal 10 MB");
    const text = await file.text();
    let items: IncomingLink[] = [];
    if (/^\s*[\[{]/.test(text)) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new HttpError(400, "File JSON tidak valid");
      }
      const arr = Array.isArray(data) ? data : Array.isArray((data as { links?: unknown[] })?.links) ? (data as { links: unknown[] }).links : [];
      for (const raw of arr as Record<string, unknown>[]) {
        const url = parseUserUrl(raw?.url ?? raw?.href ?? raw?.link);
        if (!url) continue;
        items.push({
          url,
          title: typeof raw.title === "string" ? raw.title : null,
          note: typeof raw.note === "string" ? raw.note : typeof raw.excerpt === "string" ? raw.excerpt : null,
          tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
          createdAt: typeof raw.createdAt === "number" ? raw.createdAt : typeof raw.created === "string" ? Date.parse(raw.created) : undefined,
        });
      }
    } else if (/<!DOCTYPE NETSCAPE-Bookmark-file|<DT><A /i.test(text)) {
      items = parseNetscape(text);
    } else {
      items = extractUrls(text, 5000).map((url) => ({ url }));
    }
    if (!items.length) throw new HttpError(400, "Tidak ada link yang bisa dibaca dari file ini");
    if (items.length > 5000) items = items.slice(0, 5000);
    const result = await insertMany(c, items, null, ["import"]);
    return c.json(result);
  })
  .get("/export", async (c) => {
    const user = c.get("user");
    const format = c.req.query("format") ?? "json";
    const { results } = await c.env.DB.prepare(
      `SELECT l.*, c.name AS collection_name FROM links l LEFT JOIN collections c ON c.id = l.collection_id
       WHERE l.user_id = ? AND l.deleted_at IS NULL ORDER BY l.created_at`,
    )
      .bind(user.id)
      .all<LinkRow & { collection_name: string | null }>();
    const roles = await collectionRoles(c.env.DB, user.id);
    const items = await toLinks(c.env, results, user.id, roles);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "html") {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const groups = new Map<string, typeof items>();
      items.forEach((l, i) => {
        const k = results[i].collection_name ?? "";
        groups.set(k, [...(groups.get(k) ?? []), l]);
      });
      const row = (l: (typeof items)[number]) =>
        `<DT><A HREF="${esc(l.url)}" ADD_DATE="${Math.floor(l.createdAt / 1000)}"${l.tags.length ? ` TAGS="${esc(l.tags.join(","))}"` : ""}>${esc(l.title ?? l.url)}</A>${l.note ? `\n<DD>${esc(l.note)}` : ""}`;
      let body = "";
      for (const [name, list] of groups) {
        body += name ? `<DT><H3>${esc(name)}</H3>\n<DL><p>\n${list.map(row).join("\n")}\n</DL><p>\n` : list.map(row).join("\n") + "\n";
      }
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${body}</DL><p>\n`;
      return c.body(html, 200, { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="janganlupa-${stamp}.html"` });
    }
    if (format === "csv") {
      const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = ["url,title,note,tags,collection,created_at,pinned,archived"];
      items.forEach((l, i) =>
        lines.push([l.url, l.title, l.note, l.tags.join(" "), results[i].collection_name, new Date(l.createdAt).toISOString(), l.pinned ? 1 : 0, l.archivedAt ? 1 : 0].map(q).join(",")),
      );
      return c.body("﻿" + lines.join("\n"), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="janganlupa-${stamp}.csv"` });
    }
    const json = items.map((l, i) => ({
      url: l.url,
      title: l.title,
      description: l.description,
      note: l.note,
      tags: l.tags,
      collection: results[i].collection_name,
      pinned: l.pinned,
      archived: !!l.archivedAt,
      remindAt: l.remindAt,
      createdAt: l.createdAt,
    }));
    return c.body(JSON.stringify({ exportedAt: new Date().toISOString(), links: json }, null, 2), 200, {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="janganlupa-${stamp}.json"`,
    });
  });

export const img = new Hono<AppEnv>().get("/", async (c) => {
  const u = c.req.query("u");
  const s = c.req.query("s");
  if (!u || !s || !timingSafeEqual(s, await hmac(secretOf(c.env), u))) return c.text("bad signature", 403);
  const cache = caches.default;
  const key = new Request(new URL(`/api/img?u=${encodeURIComponent(u)}`, c.req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await safeFetch(u, { headers: { accept: "image/avif,image/webp,image/png,image/*;q=0.8", "user-agent": "Mozilla/5.0 JanganLupa" }, timeout: 8000 });
    const type = res.headers.get("content-type") ?? "";
    const size = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (!res.ok || !type.startsWith("image/") || type.includes("svg") || size > 6 * 1024 * 1024) {
      res.body?.cancel();
      return c.text("not an image", 404, { "cache-control": "public, max-age=3600" });
    }
    const out = new Response(res.body, {
      headers: { "content-type": type, "cache-control": "public, max-age=604800, immutable", "x-content-type-options": "nosniff" },
    });
    c.executionCtx.waitUntil(cache.put(key, out.clone()));
    return out;
  } catch {
    return c.text("fetch failed", 404, { "cache-control": "public, max-age=600" });
  }
});

export const publicView = new Hono<AppEnv>().get("/:slug", async (c) => {
  const db = c.env.DB;
  const col = await db
    .prepare("SELECT c.id, c.name, c.color, u.name AS owner_name FROM collections c JOIN users u ON u.id = c.user_id WHERE c.public_slug = ?")
    .bind(c.req.param("slug"))
    .first<{ id: string; name: string; color: string | null; owner_name: string | null }>();
  if (!col) throw new HttpError(404, "Halaman ini tidak ada atau sudah tidak dibagikan", "not_found");
  const { results } = await db
    .prepare("SELECT * FROM links WHERE collection_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY pinned DESC, created_at DESC LIMIT 500")
    .bind(col.id)
    .all<LinkRow>();
  const items = (await toLinks(c.env, results, "", new Map())).map((l) => ({
    id: l.id,
    url: l.url,
    domain: l.domain,
    title: l.title,
    description: l.description,
    image: l.image,
    imageProxy: l.imageProxy,
    favicon: l.favicon,
    tags: l.tags,
    createdAt: l.createdAt,
  }));
  return c.json({ collection: { name: col.name, color: col.color, owner: col.owner_name }, items }, 200, { "cache-control": "public, max-age=60" });
});
