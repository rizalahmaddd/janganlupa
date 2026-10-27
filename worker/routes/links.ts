import { Hono } from "hono";
import type { AppEnv, Ctx } from "../env";
import { FEATURES } from "../../shared/features";
import { button, esc, layout, sendMail } from "../lib/email";
import { access, collectionRoles, ftsQuery, refreshMeta, setTags, syncFts, toLinks, type LinkRow, type RoleMap, type ShareRole } from "../lib/links";
import { rateLimit } from "../lib/ratelimit";
import { cleanUrl, displayDomain, extractUrls, normalizeUrl, parseUserUrl } from "../lib/url";
import { HttpError, clampNote, clampText, normalizeEmail, now, uid } from "../lib/util";

const PAGE = 40;
const DAY = 24 * 60 * 60 * 1000;
export const FORGOTTEN_AFTER = 14 * DAY;
const VIEWS = new Set(["all", "pinned", "unread", "reminders", "archive", "trash", "broken", "lupa", "shared"]);
const SORTS: Record<string, string> = {
  new: "l.created_at DESC",
  old: "l.created_at ASC",
  opened: "coalesce(l.last_opened_at, 0) DESC, l.created_at DESC",
  popular: "l.open_count DESC, l.created_at DESC",
  title: "lower(coalesce(l.title, l.domain)) ASC",
  remind: "l.remind_at ASC",
};

async function loadRow(c: Ctx, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
  if (!row) throw new HttpError(404, "Link tidak ditemukan", "not_found");
  const roles = await collectionRoles(c.env.DB, c.get("user").id);
  const share = await c.env.DB.prepare("SELECT role FROM link_shares WHERE link_id = ? AND user_id = ?").bind(id, c.get("user").id).first<{ role: ShareRole }>();
  const a = access(row, c.get("user").id, roles, share?.role);
  if (!a.canView || (row.deleted_at && !a.mine)) throw new HttpError(404, "Link tidak ditemukan", "not_found");
  return { row, roles, shareRole: share?.role ?? null, ...a };
}

async function one(c: Ctx, id: string, roles?: RoleMap) {
  const row = await c.env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
  if (!row) throw new HttpError(404, "Link tidak ditemukan", "not_found");
  const r = roles ?? (await collectionRoles(c.env.DB, c.get("user").id));
  return (await toLinks(c.env, [row], c.get("user").id, r))[0];
}

function assertWritableCollection(roles: RoleMap, collectionId: unknown): string | null {
  if (collectionId === null || collectionId === undefined || collectionId === "") return null;
  if (typeof collectionId !== "string") throw new HttpError(400, "Koleksi tidak valid");
  const role = roles.get(collectionId);
  if (role !== "owner" && role !== "editor") throw new HttpError(403, "Kamu tidak punya akses menambah ke koleksi ini", "forbidden");
  return collectionId;
}

function parseRemind(value: unknown): number | null {
  if (!FEATURES.reminders) return null;
  if (value === null || value === undefined || value === "") return null;
  const t = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(t)) throw new HttpError(400, "Waktu pengingat tidak valid");
  return t;
}

export const links = new Hono<AppEnv>()
  .get("/", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const qp = c.req.query();
    const view = VIEWS.has(qp.view) ? qp.view : "all";
    const roles = await collectionRoles(db, user.id);
    const where: string[] = [];
    const binds: unknown[] = [];
    let join = "";
    const orderBinds: unknown[] = [];
    let order = SORTS[qp.sort] ?? (view === "reminders" ? SORTS.remind : SORTS.new);

    if (view === "shared") {
      where.push("l.id IN (SELECT link_id FROM link_shares WHERE user_id = ?)");
      binds.push(user.id);
      if (!SORTS[qp.sort]) {
        order = "(SELECT created_at FROM link_shares s WHERE s.link_id = l.id AND s.user_id = ?) DESC";
        orderBinds.push(user.id);
      }
    } else if (qp.collection && qp.collection !== "none") {
      if (!roles.has(qp.collection)) throw new HttpError(404, "Koleksi tidak ditemukan", "not_found");
      where.push("l.collection_id = ?");
      binds.push(qp.collection);
    } else if (qp.q) {
      const shared = [...roles.keys()];
      where.push(`(l.user_id = ? OR l.id IN (SELECT link_id FROM link_shares WHERE user_id = ?)${shared.length ? ` OR l.collection_id IN (${shared.map(() => "?").join(",")})` : ""})`);
      binds.push(user.id, user.id, ...shared);
    } else {
      where.push("l.user_id = ?");
      binds.push(user.id);
      if (qp.collection === "none") where.push("l.collection_id IS NULL");
    }

    if (view === "trash") where.push("l.deleted_at IS NOT NULL");
    else {
      where.push("l.deleted_at IS NULL");
      if (view === "archive") where.push("l.archived_at IS NOT NULL");
      else if (!qp.q) where.push("l.archived_at IS NULL");
    }
    if (view === "pinned") where.push("l.pinned = 1");
    if (view === "unread") where.push("l.read_at IS NULL");
    if (view === "reminders") where.push("l.remind_at IS NOT NULL");
    if (view === "broken") where.push("l.status = 'broken'");
    if (view === "lupa") {
      where.push("l.open_count = 0 AND l.created_at < ?");
      binds.push(now() - FORGOTTEN_AFTER);
      // Shuffled, but stable for a day so paging doesn't repeat items.
      const seed = Math.floor(now() / DAY) % 9973;
      order = `((l.rid * 2654435761 + ${seed}) % 1000003)`;
    }
    if (qp.tag) {
      where.push("l.id IN (SELECT lt.link_id FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE t.name = ? AND t.user_id = l.user_id)");
      binds.push(qp.tag.toLowerCase());
    }
    if (qp.domain) {
      where.push("l.domain = ?");
      binds.push(qp.domain.toLowerCase().replace(/^www\./, ""));
    }

    let ftsBind: string | null = null;
    if (qp.q) {
      ftsBind = ftsQuery(qp.q);
      if (ftsBind) {
        join = "JOIN (SELECT rowid AS fid, rank FROM links_fts WHERE links_fts MATCH ?) f ON f.fid = l.rid";
        if (!SORTS[qp.sort]) {
          order = "f.rank";
          orderBinds.length = 0;
        }
      }
    }

    const offset = Math.max(0, parseInt(qp.cursor || "0", 10) || 0);
    const sql = `SELECT l.* FROM links l ${join} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${offset}`;
    let rows: LinkRow[];
    try {
      rows = (await db.prepare(sql).bind(...(ftsBind ? [ftsBind] : []), ...binds, ...orderBinds).all<LinkRow>()).results;
    } catch (e) {
      if (!ftsBind) throw e;
      // FTS syntax edge cases fall back to a plain substring search.
      const like = `%${qp.q!.replace(/[%_]/g, "")}%`;
      const fb = `SELECT l.* FROM links l WHERE ${where.join(" AND ")} AND (l.title LIKE ? OR l.url LIKE ? OR l.note LIKE ? OR l.description LIKE ?) ORDER BY l.created_at DESC LIMIT ${PAGE + 1} OFFSET ${offset}`;
      rows = (await db.prepare(fb).bind(...binds, like, like, like, like).all<LinkRow>()).results;
    }
    const more = rows.length > PAGE;
    return c.json({ items: await toLinks(c.env, rows.slice(0, PAGE), user.id, roles), next: more ? String(offset + PAGE) : null });
  })

  .post("/", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    await rateLimit(db, `add:${user.id}`, 300, 60 * 60 * 1000);
    const body = await c.req.json().catch(() => ({}));
    const url = parseUserUrl(body.url);
    if (!url) throw new HttpError(400, "URL tidak valid. Contoh: https://contoh.com/artikel", "invalid_url");
    const roles = await collectionRoles(db, user.id);
    const collectionId = assertWritableCollection(roles, body.collectionId);
    const norm = normalizeUrl(url);

    const existing = await db.prepare("SELECT * FROM links WHERE user_id = ? AND url_norm = ? ORDER BY deleted_at IS NULL DESC LIMIT 1").bind(user.id, norm).first<LinkRow>();
    if (existing && !existing.deleted_at) {
      return c.json({ duplicate: true, link: (await toLinks(c.env, [existing], user.id, roles))[0] }, 409);
    }
    if (existing && existing.deleted_at) {
      // Saving something that sits in the trash brings it back instead of creating a twin.
      await db.prepare("UPDATE links SET deleted_at = NULL, archived_at = NULL, updated_at = ? WHERE id = ?").bind(now(), existing.id).run();
      await syncFts(db, [existing.id]);
      return c.json({ restored: true, link: await one(c, existing.id, roles) });
    }

    const id = uid();
    const t = now();
    const title = clampText(body.title, 300);
    await db
      .prepare(
        `INSERT INTO links (id, user_id, collection_id, url, url_norm, domain, title, custom_title, note, remind_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, user.id, collectionId, cleanUrl(url), norm, displayDomain(url), title, 0, clampNote(body.note), parseRemind(body.remindAt), t, t)
      .run();
    if (Array.isArray(body.tags) && body.tags.length) await setTags(db, user.id, id, body.tags);
    await syncFts(db, [id]);
    c.executionCtx.waitUntil(refreshMeta(c.env, id));
    return c.json({ link: await one(c, id, roles) }, 201);
  })

  .post("/bulk", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    await rateLimit(db, `bulk:${user.id}`, 30, 60 * 60 * 1000);
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.slice(0, 500_000) : "";
    const roles = await collectionRoles(db, user.id);
    const collectionId = assertWritableCollection(roles, body.collectionId);
    const result = await insertMany(c, extractUrls(text, 1000).map((url) => ({ url })), collectionId, body.tags);
    return c.json(result);
  })

  .post("/batch", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const body = await c.req.json().catch(() => ({}));
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).filter((x: unknown) => typeof x === "string").slice(0, 200);
    if (!ids.length) return c.json({ ok: true, count: 0 });
    const t = now();
    const ph = ids.map(() => "?").join(",");
    const own = `WHERE user_id = ? AND id IN (${ph})`;
    const b = [user.id, ...ids];
    const action = String(body.action);
    switch (action) {
      case "archive": await db.prepare(`UPDATE links SET archived_at = ?, updated_at = ? ${own}`).bind(t, t, ...b).run(); break;
      case "unarchive": await db.prepare(`UPDATE links SET archived_at = NULL, updated_at = ? ${own}`).bind(t, ...b).run(); break;
      case "pin": await db.prepare(`UPDATE links SET pinned = 1, updated_at = ? ${own}`).bind(t, ...b).run(); break;
      case "unpin": await db.prepare(`UPDATE links SET pinned = 0, updated_at = ? ${own}`).bind(t, ...b).run(); break;
      case "read": await db.prepare(`UPDATE links SET read_at = coalesce(read_at, ?), updated_at = ? ${own}`).bind(t, t, ...b).run(); break;
      case "unread": await db.prepare(`UPDATE links SET read_at = NULL, updated_at = ? ${own}`).bind(t, ...b).run(); break;
      case "delete":
        await db.prepare(`UPDATE links SET deleted_at = ?, updated_at = ? ${own}`).bind(t, t, ...b).run();
        await db.prepare(`DELETE FROM links_fts WHERE rowid IN (SELECT rid FROM links ${own})`).bind(...b).run();
        break;
      case "restore": {
        const restorable = await restorableIds(db, user.id, ids);
        if (restorable.length) {
          await db.prepare(`UPDATE links SET deleted_at = NULL, updated_at = ? WHERE id IN (${restorable.map(() => "?").join(",")})`).bind(t, ...restorable).run();
          await syncFts(db, restorable);
        }
        break;
      }
      case "purge": await db.prepare(`DELETE FROM links ${own} AND deleted_at IS NOT NULL`).bind(...b).run(); break;
      case "move": {
        const roles = await collectionRoles(db, user.id);
        const cid = assertWritableCollection(roles, body.value);
        await db.prepare(`UPDATE links SET collection_id = ?, updated_at = ? ${own}`).bind(cid, t, ...b).run();
        break;
      }
      case "tag":
      case "untag": {
        const names = (Array.isArray(body.value) ? body.value : [body.value]).filter((x: unknown) => typeof x === "string");
        const { results } = await db.prepare(`SELECT id FROM links ${own}`).bind(...b).all<{ id: string }>();
        const { results: current } = await db
          .prepare(`SELECT lt.link_id, t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id IN (${ph})`)
          .bind(...ids)
          .all<{ link_id: string; name: string }>();
        for (const { id } of results) {
          const mine = current.filter((r) => r.link_id === id).map((r) => r.name);
          const next = action === "tag" ? [...mine, ...names] : mine.filter((n) => !names.map((x: string) => x.toLowerCase()).includes(n));
          await setTags(db, user.id, id, next);
        }
        await syncFts(db, results.map((r) => r.id));
        break;
      }
      default:
        throw new HttpError(400, "Aksi tidak dikenal");
    }
    return c.json({ ok: true, count: ids.length });
  })

  .get("/:id", async (c) => {
    const { row, roles } = await loadRow(c, c.req.param("id"));
    return c.json({ link: (await toLinks(c.env, [row], c.get("user").id, roles))[0] });
  })

  .patch("/:id", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const { row, roles, mine, canEdit, isCollectionOwner } = await loadRow(c, c.req.param("id"));
    if (!canEdit) throw new HttpError(403, "Kamu hanya bisa melihat link ini", "forbidden");
    const body = await c.req.json().catch(() => ({}));
    const sets: string[] = [];
    const binds: unknown[] = [];
    const set = (sql: string, ...v: unknown[]) => {
      sets.push(sql);
      binds.push(...v);
    };
    const ownerOnly = (field: string) => {
      if (!mine) throw new HttpError(403, `Hanya pemilik link yang bisa mengubah ${field}`, "forbidden");
    };
    const t = now();
    let refetch = false;

    if ("title" in body) {
      const title = clampText(body.title, 300);
      set("title = ?, custom_title = ?", title, title ? 1 : 0);
    }
    if ("description" in body) set("description = ?", clampText(body.description, 1000));
    if ("note" in body) set("note = ?", clampNote(body.note));
    if ("image" in body) {
      const img = body.image ? parseUserUrl(body.image) : null;
      if (body.image && !img) throw new HttpError(400, "URL gambar tidak valid");
      set("image_url = ?, custom_image = ?", img?.toString() ?? null, img ? 1 : 0);
    }
    if ("url" in body) {
      ownerOnly("URL");
      const url = parseUserUrl(body.url);
      if (!url) throw new HttpError(400, "URL tidak valid", "invalid_url");
      const norm = normalizeUrl(url);
      if (norm !== row.url_norm) {
        const dup = await db.prepare("SELECT id FROM links WHERE user_id = ? AND url_norm = ? AND deleted_at IS NULL AND id != ?").bind(user.id, norm, row.id).first();
        if (dup) throw new HttpError(409, "URL ini sudah tersimpan di link lain", "duplicate");
        set("url = ?, url_norm = ?, domain = ?, status = 'pending', fetch_attempts = 0", cleanUrl(url), norm, displayDomain(url));
        refetch = true;
      }
    }
    if ("collectionId" in body) {
      if (mine) set("collection_id = ?", assertWritableCollection(roles, body.collectionId));
      else if (isCollectionOwner && body.collectionId === null) set("collection_id = NULL");
      else throw new HttpError(403, "Hanya pemilik link yang bisa memindahkan koleksi", "forbidden");
    }
    if ("pinned" in body) (ownerOnly("pin"), set("pinned = ?", body.pinned ? 1 : 0));
    if ("read" in body) (ownerOnly("status baca"), set("read_at = ?", body.read ? row.read_at ?? t : null));
    if ("archived" in body) (ownerOnly("arsip"), set("archived_at = ?", body.archived ? row.archived_at ?? t : null));
    if ("remindAt" in body) (ownerOnly("pengingat"), set("remind_at = ?, reminded_at = NULL", parseRemind(body.remindAt)));

    if (sets.length) {
      set("updated_at = ?", t);
      await db.prepare(`UPDATE links SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, row.id).run();
    }
    if ("tags" in body) await setTags(db, row.user_id, row.id, body.tags);
    await syncFts(db, [row.id]);
    if (refetch) c.executionCtx.waitUntil(refreshMeta(c.env, row.id, true));
    return c.json({ link: await one(c, row.id, roles) });
  })

  .delete("/:id", async (c) => {
    const db = c.env.DB;
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (!mine) throw new HttpError(403, "Hanya pemilik yang bisa menghapus link", "forbidden");
    if (c.req.query("permanent") === "1") {
      await db.batch([db.prepare("DELETE FROM links_fts WHERE rowid = ?").bind(row.rid), db.prepare("DELETE FROM links WHERE id = ?").bind(row.id)]);
      return c.json({ ok: true, purged: true });
    }
    const t = now();
    await db.batch([
      db.prepare("UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(t, t, row.id),
      db.prepare("DELETE FROM links_fts WHERE rowid = ?").bind(row.rid),
    ]);
    return c.json({ ok: true });
  })

  .post("/:id/restore", async (c) => {
    const user = c.get("user");
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (!mine) throw new HttpError(403, "Tidak diizinkan", "forbidden");
    const ok = await restorableIds(c.env.DB, user.id, [row.id]);
    if (!ok.length) throw new HttpError(409, "URL yang sama sudah tersimpan lagi. Hapus permanen salah satunya.", "duplicate");
    await c.env.DB.prepare("UPDATE links SET deleted_at = NULL, updated_at = ? WHERE id = ?").bind(now(), row.id).run();
    await syncFts(c.env.DB, [row.id]);
    return c.json({ link: await one(c, row.id) });
  })

  .post("/:id/refresh", async (c) => {
    const { row, canEdit } = await loadRow(c, c.req.param("id"));
    if (!canEdit) throw new HttpError(403, "Tidak diizinkan", "forbidden");
    await rateLimit(c.env.DB, `refresh:${c.get("user").id}`, 60, 60 * 60 * 1000);
    await refreshMeta(c.env, row.id, true);
    return c.json({ link: await one(c, row.id) });
  })

  .post("/:id/open", async (c) => {
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (mine) {
      const t = now();
      await c.env.DB.prepare("UPDATE links SET open_count = open_count + 1, last_opened_at = ?, read_at = coalesce(read_at, ?) WHERE id = ?").bind(t, t, row.id).run();
    }
    return c.json({ ok: true });
  })

  .get("/:id/related", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const { row, roles } = await loadRow(c, c.req.param("id"));
    const shared = [...roles.keys()];
    const scope = `(l.user_id = ? OR l.id IN (SELECT link_id FROM link_shares WHERE user_id = ?)${shared.length ? ` OR l.collection_id IN (${shared.map(() => "?").join(",")})` : ""})`;
    const { results } = await db
      .prepare(
        `SELECT * FROM (
           SELECT l.*,
             (SELECT COUNT(*) FROM link_tags a JOIN link_tags b ON a.tag_id = b.tag_id WHERE a.link_id = l.id AND b.link_id = ?) * 3
             + CASE WHEN l.domain = ? THEN 2 ELSE 0 END
             + CASE WHEN l.collection_id IS NOT NULL AND l.collection_id = ? THEN 2 ELSE 0 END AS score
           FROM links l WHERE ${scope} AND l.id != ? AND l.deleted_at IS NULL
         ) WHERE score > 0 ORDER BY score DESC, created_at DESC LIMIT 8`,
      )
      .bind(row.id, row.domain, row.collection_id, user.id, user.id, ...shared, row.id)
      .all<LinkRow & { score: number }>();

    let byText: LinkRow[] = [];
    const words = keywords(`${row.title ?? ""} ${row.note ?? ""}`);
    if (words.length && results.length < 8) {
      const match = words.map((w) => `"${w}"`).join(" OR ");
      byText = (
        await db
          .prepare(`SELECT l.* FROM links l JOIN (SELECT rowid AS fid, rank FROM links_fts WHERE links_fts MATCH ?) f ON f.fid = l.rid WHERE ${scope} AND l.id != ? AND l.deleted_at IS NULL ORDER BY f.rank LIMIT 8`)
          .bind(match, user.id, user.id, ...shared, row.id)
          .all<LinkRow>()
          .catch(() => ({ results: [] as LinkRow[] }))
      ).results;
    }
    const seen = new Set<string>();
    const merged = [...results, ...byText].filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 8);
    return c.json({ items: await toLinks(c.env, merged, user.id, roles) });
  })

  .get("/:id/shares", async (c) => {
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (!mine) throw new HttpError(403, "Hanya pemilik yang bisa melihat daftar akses", "forbidden");
    const { results } = await c.env.DB.prepare("SELECT email, role, user_id FROM link_shares WHERE link_id = ? ORDER BY created_at").bind(row.id).all<{ email: string; role: ShareRole; user_id: string | null }>();
    return c.json({ items: results.map((r) => ({ email: r.email, role: r.role, joined: !!r.user_id })) });
  })

  .post("/:id/shares", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (!mine) throw new HttpError(403, "Hanya pemilik yang bisa membagikan link ini", "forbidden");
    if (row.deleted_at) throw new HttpError(400, "Pulihkan link dari sampah dulu sebelum dibagikan");
    const body = await c.req.json().catch(() => ({}));
    const emails = [...new Set((Array.isArray(body.emails) ? body.emails : [body.email]).map(normalizeEmail))];
    if (!emails.length || emails.some((e) => !e)) throw new HttpError(400, "Ada email yang tidak valid", "invalid_email");
    if (emails.includes(user.email)) throw new HttpError(400, "Tidak perlu membagikan ke diri sendiri");
    if (emails.length > 20) throw new HttpError(400, "Maksimal 20 email sekaligus");
    const role: ShareRole = body.role === "editor" ? "editor" : "viewer";
    await rateLimit(db, `share:${user.id}`, 100, 24 * 60 * 60 * 1000);
    const message = clampText(body.message, 300);
    const fresh: string[] = [];
    for (const email of emails as string[]) {
      const target = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
      const prev = await db.prepare("SELECT role FROM link_shares WHERE link_id = ? AND email = ?").bind(row.id, email).first();
      await db
        .prepare(
          `INSERT INTO link_shares (link_id, email, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(link_id, email) DO UPDATE SET role = excluded.role`,
        )
        .bind(row.id, email, target?.id ?? null, role, user.id, now())
        .run();
      if (!prev) fresh.push(email);
    }
    const who = user.name || user.email;
    const title = row.title || row.domain;
    const open = `${c.env.APP_URL}/?view=shared&link=${row.id}`;
    c.executionCtx.waitUntil(
      Promise.all(
        fresh.map((email) =>
          sendMail(c.env, {
            to: email,
            subject: `${who} membagikan link: ${title}`,
            text: `${who} membagikan link ke kamu di ${c.env.APP_NAME}:\n\n${title}\n${row.url}${message ? `\n\nPesan: ${message}` : ""}\n\nBuka di ${c.env.APP_NAME}: ${open}\nMasuk memakai email ini: ${email}`,
            html: layout(
              c.env,
              `${who} membagikan link`,
              `<p style="margin:0 0 6px;font-weight:600;font-size:16px">${esc(title)}</p>
<p style="margin:0 0 16px;color:#8a847a;font-size:13px;word-break:break-all">${esc(row.url)}</p>
${message ? `<p style="margin:0 0 16px;padding:10px 12px;background:#f4f2ee;border-radius:8px">${esc(message)}</p>` : ""}
<p style="margin:0 0 20px">${button(open, "Buka di JanganLupa")}</p>
<p style="margin:0;color:#8a847a;font-size:13px">Link ini juga muncul di menu <b>Dibagikan ke saya</b>. Masuk memakai ${esc(email)}; akun dibuat otomatis kalau belum ada.</p>`,
            ),
          }).catch((e) => console.error("share mail failed", e)),
        ),
      ).then(() => undefined),
    );
    return c.json({ ok: true, added: fresh.length, updated: emails.length - fresh.length });
  })

  .delete("/:id/shares/:email", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const email = decodeURIComponent(c.req.param("email")).toLowerCase();
    const row = await c.env.DB.prepare("SELECT user_id FROM links WHERE id = ?").bind(id).first<{ user_id: string }>();
    if (!row) throw new HttpError(404, "Link tidak ditemukan", "not_found");
    // The owner revokes anyone; a recipient can only remove the link from their own "shared with me".
    if (row.user_id !== user.id && email !== user.email) throw new HttpError(403, "Tidak diizinkan", "forbidden");
    await c.env.DB.prepare("DELETE FROM link_shares WHERE link_id = ? AND email = ?").bind(id, email).run();
    return c.json({ ok: true });
  })

  .post("/:id/copy", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const { row, mine } = await loadRow(c, c.req.param("id"));
    if (mine) throw new HttpError(400, "Link ini sudah milikmu");
    const existing = await db.prepare("SELECT id FROM links WHERE user_id = ? AND url_norm = ? AND deleted_at IS NULL").bind(user.id, row.url_norm).first<{ id: string }>();
    if (existing) return c.json({ duplicate: true, link: await one(c, existing.id) });
    const id = uid();
    const t = now();
    await db
      .prepare(
        `INSERT INTO links (id, user_id, url, url_norm, domain, title, description, image_url, favicon_url, site_name, content_type, status, http_status, checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, user.id, row.url, row.url_norm, row.domain, row.title, row.description, row.image_url, row.favicon_url, row.site_name, row.content_type, row.status, row.http_status, row.checked_at, t, t)
      .run();
    await syncFts(db, [id]);
    return c.json({ link: await one(c, id) }, 201);
  });

const STOP = new Set("yang dan untuk dengan dari pada dalam adalah akan atau juga tidak sudah bisa this that with from your have will what when about into they them their there which these those than then also more most some such just like how why the and for are was were been being".split(" "));

function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].sort((a, b) => b.length - a.length).slice(0, 5);
}

async function restorableIds(db: D1Database, userId: string, ids: string[]): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id FROM links l WHERE l.user_id = ? AND l.id IN (${ids.map(() => "?").join(",")}) AND l.deleted_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM links o WHERE o.user_id = l.user_id AND o.url_norm = l.url_norm AND o.deleted_at IS NULL)`,
    )
    .bind(userId, ...ids)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export interface IncomingLink {
  url: URL;
  title?: string | null;
  note?: string | null;
  tags?: string[];
  createdAt?: number;
  collectionId?: string | null;
}

export async function insertMany(c: Ctx, items: IncomingLink[], collectionId: string | null, extraTags?: unknown) {
  const user = c.get("user");
  const db = c.env.DB;
  const byNorm = new Map<string, IncomingLink>();
  for (const it of items) {
    const norm = normalizeUrl(it.url);
    if (!byNorm.has(norm)) byNorm.set(norm, it);
  }
  const norms = [...byNorm.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < norms.length; i += 90) {
    const chunk = norms.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT url_norm FROM links WHERE user_id = ? AND deleted_at IS NULL AND url_norm IN (${chunk.map(() => "?").join(",")})`)
      .bind(user.id, ...chunk)
      .all<{ url_norm: string }>();
    results.forEach((r) => existing.add(r.url_norm));
  }
  const t = now();
  const fresh = norms.filter((n) => !existing.has(n));
  const created: { id: string; tags: string[] }[] = [];
  const stmts: D1PreparedStatement[] = [];
  const extra = Array.isArray(extraTags) ? extraTags.filter((x): x is string => typeof x === "string") : [];
  for (const norm of fresh) {
    const it = byNorm.get(norm)!;
    const id = uid();
    const created_at = it.createdAt && it.createdAt > 0 && it.createdAt < t ? it.createdAt : t;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO links (id, user_id, collection_id, url, url_norm, domain, title, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, user.id, it.collectionId ?? collectionId, cleanUrl(it.url), norm, displayDomain(it.url), clampText(it.title, 300), clampNote(it.note), created_at, t),
    );
    created.push({ id, tags: [...(it.tags ?? []), ...extra] });
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  for (const it of created) if (it.tags.length) await setTags(db, user.id, it.id, it.tags);
  await syncFts(db, created.map((x) => x.id));
  // Free-tier Workers allow ~50 subrequests per invocation; the cron picks up the rest.
  const firstBatch = created.slice(0, 8);
  c.executionCtx.waitUntil(Promise.all(firstBatch.map((x) => refreshMeta(c.env, x.id))).then(() => undefined));
  return { added: created.length, duplicates: norms.length - fresh.length, total: items.length };
}
