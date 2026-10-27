import type { Env } from "../env";
import { setTags, syncFts } from "./links";
import { displayDomain, normalizeUrl } from "./url";
import { now, uid } from "./util";

const NOTE = `Contoh catatan: tulis kenapa kamu menyimpan link, supaya bulan depan masih ingat konteksnya.

Coba:
• Tempel link di mana saja (Ctrl/⌘+V) untuk langsung menyimpan
• Cari pakai kata apa pun yang kamu ingat: judul, catatan, nama situs, atau #tag
• Bagikan link atau koleksi ke email teman, nanti muncul di "Dibagikan ke saya" miliknya

Link ini boleh dihapus kapan saja.`;

export async function seedDemo(env: Env, userId: string) {
  const url = new URL("/panduan", env.APP_URL);
  const id = uid();
  const t = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO links (id, user_id, url, url_norm, domain, title, description, note, image_url, favicon_url, site_name, content_type, status, http_status, checked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'text/html', 'ok', 200, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      url.toString(),
      normalizeUrl(url),
      displayDomain(url),
      "Panduan JanganLupa: simpan link, temukan lagi",
      "Cara tercepat menyimpan link dari HP dan laptop, mencarinya lagi, dan berbagi ke teman.",
      NOTE,
      new URL("/og.png", env.APP_URL).toString(),
      new URL("/icons/icon-192.png", env.APP_URL).toString(),
      env.APP_NAME,
      t,
      t,
      t,
    )
    .run();
  await setTags(env.DB, userId, id, ["panduan"]);
  await syncFts(env.DB, [id]);
}
