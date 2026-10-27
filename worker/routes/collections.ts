import { Hono } from "hono";
import type { Collection } from "../../shared/types";
import type { AppEnv, Ctx } from "../env";
import { button, esc, layout, sendMail } from "../lib/email";
import { collectionRoles } from "../lib/links";
import { rateLimit } from "../lib/ratelimit";
import { HttpError, clampText, normalizeEmail, now, randomToken, uid } from "../lib/util";

const COLORS = new Set(["teal", "amber", "rose", "sky", "violet", "lime", "slate", "orange"]);

async function listCollections(c: Ctx): Promise<Collection[]> {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.color, c.public_slug, c.position, u.email AS owner_email,
       CASE WHEN c.user_id = ?1 THEN 'owner' ELSE m.role END AS role,
       CASE WHEN c.user_id != ?1 AND m.seen_at IS NULL THEN 1 ELSE 0 END AS is_new,
       (SELECT COUNT(*) FROM links l WHERE l.collection_id = c.id AND l.deleted_at IS NULL AND l.archived_at IS NULL) AS link_count,
       (SELECT COUNT(*) FROM collection_members cm WHERE cm.collection_id = c.id) AS member_count
     FROM collections c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN collection_members m ON m.collection_id = c.id AND m.user_id = ?1
     WHERE c.user_id = ?1 OR m.user_id = ?1
     ORDER BY (c.user_id = ?1) DESC, c.position, lower(c.name)`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; color: string | null; public_slug: string | null; owner_email: string; role: Collection["role"]; link_count: number; member_count: number; is_new: number }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    publicSlug: r.role === "owner" ? r.public_slug : null,
    role: r.role,
    ownerEmail: r.owner_email,
    linkCount: r.link_count,
    memberCount: r.member_count,
    isNew: !!r.is_new,
  }));
}

async function ownCollection(c: Ctx, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM collections WHERE id = ? AND user_id = ?").bind(id, c.get("user").id).first<{ id: string; name: string; public_slug: string | null }>();
  if (!row) throw new HttpError(404, "Koleksi tidak ditemukan atau bukan milikmu", "not_found");
  return row;
}

export const collections = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listCollections(c) }))

  .post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const name = clampText(body.name, 60);
    if (!name) throw new HttpError(400, "Nama koleksi wajib diisi");
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM collections WHERE user_id = ?").bind(user.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 200) throw new HttpError(400, "Maksimal 200 koleksi");
    const id = uid();
    const t = now();
    await c.env.DB.prepare("INSERT INTO collections (id, user_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, user.id, name, COLORS.has(body.color) ? body.color : "teal", count?.n ?? 0, t, t)
      .run();
    return c.json({ item: (await listCollections(c)).find((x) => x.id === id) }, 201);
  })

  .patch("/:id", async (c) => {
    const col = await ownCollection(c, c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const name = "name" in body ? clampText(body.name, 60) : undefined;
    if (name === null) throw new HttpError(400, "Nama koleksi wajib diisi");
    await c.env.DB.prepare("UPDATE collections SET name = coalesce(?, name), color = coalesce(?, color), updated_at = ? WHERE id = ?")
      .bind(name ?? null, COLORS.has(body.color) ? body.color : null, now(), col.id)
      .run();
    return c.json({ item: (await listCollections(c)).find((x) => x.id === col.id) });
  })

  .delete("/:id", async (c) => {
    const col = await ownCollection(c, c.req.param("id"));
    const db = c.env.DB;
    const t = now();
    const mode = c.req.query("links") === "delete" ? "delete" : "keep";
    const stmts = [];
    if (mode === "delete") {
      stmts.push(db.prepare("DELETE FROM links_fts WHERE rowid IN (SELECT rid FROM links WHERE collection_id = ? AND user_id = ?)").bind(col.id, c.get("user").id));
      stmts.push(db.prepare("UPDATE links SET deleted_at = ?, collection_id = NULL, updated_at = ? WHERE collection_id = ? AND user_id = ?").bind(t, t, col.id, c.get("user").id));
    }
    // Links that members added stay with their owners, just without the collection.
    stmts.push(db.prepare("UPDATE links SET collection_id = NULL, updated_at = ? WHERE collection_id = ?").bind(t, col.id));
    stmts.push(db.prepare("DELETE FROM collection_members WHERE collection_id = ?").bind(col.id));
    stmts.push(db.prepare("DELETE FROM collections WHERE id = ?").bind(col.id));
    await db.batch(stmts);
    return c.json({ ok: true });
  })

  .post("/:id/leave", async (c) => {
    const user = c.get("user");
    const res = await c.env.DB.prepare("DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?").bind(c.req.param("id"), user.id).run();
    if (!res.meta.changes) throw new HttpError(404, "Kamu bukan anggota koleksi ini");
    return c.json({ ok: true });
  })

  .get("/:id/members", async (c) => {
    const roles = await collectionRoles(c.env.DB, c.get("user").id);
    const id = c.req.param("id");
    if (!roles.has(id)) throw new HttpError(404, "Koleksi tidak ditemukan", "not_found");
    const { results } = await c.env.DB.prepare("SELECT email, role, user_id FROM collection_members WHERE collection_id = ? ORDER BY created_at").bind(id).all<{ email: string; role: "viewer" | "editor"; user_id: string | null }>();
    return c.json({ items: results.map((r) => ({ email: r.email, role: r.role, joined: !!r.user_id })) });
  })

  .post("/:id/members", async (c) => {
    const user = c.get("user");
    const col = await ownCollection(c, c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "Email tidak valid", "invalid_email");
    if (email === user.email) throw new HttpError(400, "Kamu sudah pemilik koleksi ini");
    const role = body.role === "editor" ? "editor" : "viewer";
    await rateLimit(c.env.DB, `invite:${user.id}`, 50, 24 * 60 * 60 * 1000);
    const db = c.env.DB;
    const existingUser = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    const prev = await db.prepare("SELECT role FROM collection_members WHERE collection_id = ? AND email = ?").bind(col.id, email).first<{ role: string }>();
    await db
      .prepare(
        `INSERT INTO collection_members (collection_id, email, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection_id, email) DO UPDATE SET role = excluded.role`,
      )
      .bind(col.id, email, existingUser?.id ?? null, role, user.id, now())
      .run();
    if (!prev) {
      const link = `${c.env.APP_URL}/?c=${col.id}`;
      const who = user.name || user.email;
      c.executionCtx.waitUntil(
        sendMail(c.env, {
          to: email,
          subject: `${who} membagikan koleksi "${col.name}"`,
          text: `${who} membagikan koleksi "${col.name}" ke kamu di ${c.env.APP_NAME} (${role === "editor" ? "bisa mengedit" : "bisa melihat"}).\n\nBuka: ${link}\nMasuk memakai email ini: ${email}`,
          html: layout(
            c.env,
            `Koleksi "${col.name}" dibagikan ke kamu`,
            `<p style="margin:0 0 20px">${esc(who)} mengundangmu ${role === "editor" ? "untuk ikut mengelola" : "untuk melihat"} koleksi <b>${esc(col.name)}</b>.</p>
<p style="margin:0 0 20px">${button(link, "Buka koleksi")}</p>
<p style="margin:0;color:#8a847a;font-size:13px">Masuk memakai alamat ${esc(email)}. Belum punya akun? Akun dibuat otomatis saat kamu masuk.</p>`,
          ),
        }).catch((e) => console.error("invite mail failed", e)),
      );
    }
    return c.json({ ok: true, updated: !!prev });
  })

  .delete("/:id/members/:email", async (c) => {
    const col = await ownCollection(c, c.req.param("id"));
    await c.env.DB.prepare("DELETE FROM collection_members WHERE collection_id = ? AND email = ?").bind(col.id, decodeURIComponent(c.req.param("email")).toLowerCase()).run();
    return c.json({ ok: true });
  })

  .post("/:id/public", async (c) => {
    const col = await ownCollection(c, c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const slug = body.enabled === false ? null : body.regenerate || !col.public_slug ? randomToken(9) : col.public_slug;
    await c.env.DB.prepare("UPDATE collections SET public_slug = ?, updated_at = ? WHERE id = ?").bind(slug, now(), col.id).run();
    return c.json({ slug });
  });
