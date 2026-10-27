import type { Link, LinkStatus, Role } from "../../shared/types";
import type { Env } from "../env";
import { secretOf } from "../env";
import { FetchError, fetchMeta } from "./meta";
import { hmac, normalizeTag, now, uid } from "./util";

export interface LinkRow {
  rid: number;
  id: string;
  user_id: string;
  collection_id: string | null;
  url: string;
  url_norm: string;
  domain: string;
  title: string | null;
  custom_title: number;
  description: string | null;
  note: string | null;
  image_url: string | null;
  custom_image: number;
  favicon_url: string | null;
  site_name: string | null;
  content_type: string | null;
  status: LinkStatus;
  http_status: number | null;
  fetch_error: string | null;
  fetch_attempts: number;
  checked_at: number | null;
  pinned: number;
  read_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
  remind_at: number | null;
  reminded_at: number | null;
  open_count: number;
  last_opened_at: number | null;
  created_at: number;
  updated_at: number;
}

export type RoleMap = Map<string, Role>;

export async function collectionRoles(db: D1Database, userId: string): Promise<RoleMap> {
  const { results } = await db
    .prepare(
      `SELECT id, 'owner' AS role FROM collections WHERE user_id = ?1
       UNION ALL
       SELECT collection_id AS id, role FROM collection_members WHERE user_id = ?1`,
    )
    .bind(userId)
    .all<{ id: string; role: Role }>();
  return new Map(results.map((r) => [r.id, r.role]));
}

export type ShareRole = "viewer" | "editor";

export function access(row: Pick<LinkRow, "user_id" | "collection_id">, userId: string, roles: RoleMap, shareRole?: ShareRole | null) {
  const mine = row.user_id === userId;
  const role = row.collection_id ? roles.get(row.collection_id) : undefined;
  return {
    mine,
    canView: mine || !!role || !!shareRole,
    canEdit: mine || role === "owner" || role === "editor" || shareRole === "editor",
    isCollectionOwner: role === "owner",
  };
}

export async function directShares(db: D1Database, userId: string, ids: string[]): Promise<Map<string, { role: ShareRole; seen: boolean }>> {
  const map = new Map<string, { role: ShareRole; seen: boolean }>();
  if (!userId) return map;
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(`SELECT link_id, role, seen_at FROM link_shares WHERE user_id = ? AND link_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(userId, ...chunk)
      .all<{ link_id: string; role: ShareRole; seen_at: number | null }>();
    results.forEach((r) => map.set(r.link_id, { role: r.role, seen: !!r.seen_at }));
  }
  return map;
}

export async function imageProxy(env: Env, url: string | null): Promise<string | null> {
  if (!url) return null;
  return `/api/img?u=${encodeURIComponent(url)}&s=${await hmac(secretOf(env), url)}`;
}

export async function tagsFor(db: D1Database, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(`SELECT lt.link_id, t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id IN (${chunk.map(() => "?").join(",")}) ORDER BY t.name`)
      .bind(...chunk)
      .all<{ link_id: string; name: string }>();
    for (const r of results) {
      const list = map.get(r.link_id) ?? [];
      list.push(r.name);
      map.set(r.link_id, list);
    }
  }
  return map;
}

export async function toLinks(env: Env, rows: LinkRow[], userId: string, roles: RoleMap): Promise<(Link & { imageProxy: string | null })[]> {
  const ids = rows.map((r) => r.id);
  const tags = await tagsFor(env.DB, ids);
  const shares = await directShares(env.DB, userId, ids.filter((_, i) => rows[i].user_id !== userId));
  const owners = new Map<string, string>();
  const foreign = [...new Set(rows.filter((r) => r.user_id !== userId).map((r) => r.user_id))];
  if (foreign.length) {
    const { results } = await env.DB.prepare(`SELECT id, coalesce(name, email) AS who FROM users WHERE id IN (${foreign.map(() => "?").join(",")})`).bind(...foreign).all<{ id: string; who: string }>();
    results.forEach((u) => owners.set(u.id, u.who));
  }
  const shareCounts = new Map<string, number>();
  const ownIds = ids.filter((_, i) => rows[i].user_id === userId);
  for (let i = 0; i < ownIds.length; i += 90) {
    const chunk = ownIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT link_id, COUNT(*) AS n FROM link_shares WHERE link_id IN (${chunk.map(() => "?").join(",")}) GROUP BY link_id`).bind(...chunk).all<{ link_id: string; n: number }>();
    results.forEach((r) => shareCounts.set(r.link_id, r.n));
  }
  return Promise.all(
    rows.map(async (r) => {
      const share = shares.get(r.id);
      const a = access(r, userId, roles, share?.role);
      return {
        id: r.id,
        userId: r.user_id,
        collectionId: r.collection_id,
        url: r.url,
        domain: r.domain,
        title: r.title,
        description: r.description,
        note: r.note,
        image: r.image_url,
        imageProxy: await imageProxy(env, r.image_url),
        favicon: r.favicon_url,
        siteName: r.site_name,
        contentType: r.content_type,
        status: r.status,
        httpStatus: r.http_status,
        pinned: !!r.pinned,
        readAt: r.read_at,
        archivedAt: r.archived_at,
        deletedAt: r.deleted_at,
        remindAt: r.remind_at,
        remindedAt: r.reminded_at,
        openCount: r.open_count,
        lastOpenedAt: r.last_opened_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        tags: tags.get(r.id) ?? [],
        mine: a.mine,
        canEdit: a.canEdit,
        sharedBy: a.mine ? null : owners.get(r.user_id) ?? null,
        shareRole: share?.role ?? null,
        shareNew: !!share && !share.seen,
        shareCount: shareCounts.get(r.id) ?? 0,
      };
    }),
  );
}

export async function setTags(db: D1Database, ownerId: string, linkId: string, raw: unknown): Promise<void> {
  const names = [...new Set((Array.isArray(raw) ? raw : []).filter((t): t is string => typeof t === "string").map(normalizeTag).filter((t): t is string => !!t))].slice(0, 30);
  const t = now();
  const stmts = [db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId)];
  for (const name of names) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").bind(uid(), ownerId, name, t));
    stmts.push(db.prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) SELECT ?, id FROM tags WHERE user_id = ? AND name = ?").bind(linkId, ownerId, name));
  }
  await db.batch(stmts);
}

export async function syncFts(db: D1Database, linkIds: string[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const id of linkIds) {
    stmts.push(db.prepare("DELETE FROM links_fts WHERE rowid = (SELECT rid FROM links WHERE id = ?)").bind(id));
    stmts.push(
      db
        .prepare(
          `INSERT INTO links_fts (rowid, title, description, note, url, tags)
           SELECT l.rid, coalesce(l.title, ''), coalesce(l.description, '') || ' ' || coalesce(l.site_name, ''), coalesce(l.note, ''),
                  l.domain || ' ' || l.url,
                  coalesce((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id), '')
           FROM links l WHERE l.id = ? AND l.deleted_at IS NULL`,
        )
        .bind(id),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
}

export async function syncFtsForTag(db: D1Database, tagId: string): Promise<void> {
  const { results } = await db.prepare("SELECT link_id FROM link_tags WHERE tag_id = ?").bind(tagId).all<{ link_id: string }>();
  await syncFts(db, results.map((r) => r.link_id));
}

export function ftsQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .split(/[\s"'`()*:^+\-]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}._/@#]/gu, "").replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export async function refreshMeta(env: Env, id: string, force = false): Promise<void> {
  const row = await env.DB.prepare("SELECT id, url, custom_title, custom_image, title, fetch_attempts FROM links WHERE id = ?").bind(id).first<LinkRow>();
  if (!row) return;
  const t = now();
  try {
    const meta = await fetchMeta(row.url);
    await env.DB.prepare(
      `UPDATE links SET
         title = CASE WHEN custom_title = 1 OR (?9 = 0 AND title IS NOT NULL) THEN title ELSE coalesce(?1, title) END,
         description = CASE WHEN ?9 = 1 THEN coalesce(?2, description) ELSE coalesce(description, ?2) END,
         image_url = CASE WHEN custom_image = 1 THEN image_url ELSE coalesce(?3, image_url) END,
         favicon_url = coalesce(?4, favicon_url),
         site_name = coalesce(?5, site_name),
         content_type = ?6,
         http_status = ?7,
         status = 'ok', fetch_error = NULL, fetch_attempts = 0, checked_at = ?8
       WHERE id = ?10`,
    )
      .bind(meta.title, meta.description, meta.image, meta.favicon, meta.siteName, meta.contentType, meta.httpStatus, t, force ? 1 : 0, id)
      .run();
  } catch (e) {
    const err = e instanceof FetchError ? e : new FetchError(e instanceof Error ? e.message : "Gagal");
    await env.DB.prepare(
      "UPDATE links SET status = ?, http_status = ?, fetch_error = ?, fetch_attempts = fetch_attempts + 1, checked_at = ?, favicon_url = coalesce(favicon_url, ?) WHERE id = ?",
    )
      .bind(err.permanent ? "broken" : "failed", err.httpStatus, err.message.slice(0, 200), t, faviconGuess(row.url), id)
      .run();
  }
  await syncFts(env.DB, [id]);
}

function faviconGuess(url: string): string | null {
  try {
    return new URL("/favicon.ico", url).toString();
  } catch {
    return null;
  }
}

export async function checkHealth(env: Env, id: string, url: string): Promise<void> {
  const t = now();
  try {
    const meta = await fetchMeta(url);
    await env.DB.prepare("UPDATE links SET status = 'ok', http_status = ?, fetch_error = NULL, fetch_attempts = 0, checked_at = ? WHERE id = ?").bind(meta.httpStatus, t, id).run();
  } catch (e) {
    const err = e instanceof FetchError ? e : new FetchError("Gagal");
    // A single timeout or bot block isn't proof the page is gone; three in a row is.
    await env.DB.prepare(
      `UPDATE links SET http_status = coalesce(?, http_status), fetch_error = ?, checked_at = ?, fetch_attempts = fetch_attempts + 1,
         status = CASE WHEN ? = 1 OR fetch_attempts + 1 >= 3 THEN 'broken' ELSE status END
       WHERE id = ?`,
    )
      .bind(err.httpStatus, err.message.slice(0, 200), t, err.permanent ? 1 : 0, id)
      .run();
  }
}
