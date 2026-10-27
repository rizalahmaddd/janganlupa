# Arsitektur

## Stack

| Bagian | Pilihan | Alasan |
|---|---|---|
| Runtime | Satu Cloudflare Worker dengan [Hono](https://hono.dev) | API dan aset statis dalam satu deploy; 100 ribu request/hari gratis |
| Frontend | React 19 + Vite, SPA | Disajikan Workers Static Assets; request aset statis tidak dihitung kuota |
| Database | D1 (SQLite) + FTS5 | Pencarian full-text tanpa layanan tambahan |
| Metadata | `fetch` + `HTMLRewriter` streaming | Hanya membaca bagian awal HTML (maks 512 KB), tanpa headless browser |
| Thumbnail | Dimuat langsung oleh browser, fallback ke proxy bertanda tangan | Tidak memakan kuota Worker kecuali situsnya memblokir hotlink |
| Email | Resend HTTP API | Worker tidak bisa memakai SMTP |
| Rate limit | Tabel D1 | KV free tier hanya 1.000 tulis/hari |

## Struktur folder

```
worker/            API di Cloudflare Worker
  index.ts         router, CSRF, sesi, runner pekerjaan latar belakang
  routes/          auth, links, collections, misc (me, tags, stats, import/ekspor, gambar, publik)
  lib/             url (normalisasi, SSRF), meta (pembaca halaman), links (akses, FTS), email, demo
src/               frontend React
  layouts/         DesktopLayout, TabletLayout, MobileLayout, dan state bersama (shell.tsx)
  components/      kartu link, detail, form simpan, dialog berbagi, navigasi, sheet
  pages/           login, verifikasi, halaman publik koleksi, halaman simpan (share target)
  lib/             api client, router kecil, state, antrean offline
shared/            tipe dan flag fitur yang dipakai frontend dan Worker
migrations/        migrasi SQL D1
public/            manifest PWA, service worker, ikon, halaman /panduan
tests/             test API end-to-end
```

## Model data

- `users`, `sessions` (hash token, 30 hari, sliding), `login_tokens` (hash token + hash kode, sekali pakai).
- `links`: satu baris per URL per user. `url_norm` + index unik parsial mencegah duplikat. `rid INTEGER PRIMARY KEY` menjadi rowid stabil untuk `links_fts`. `custom_title` / `custom_image` mencegah pembaruan metadata menimpa editan user.
- `tags` + `link_tags`; `collections` (satu link maksimal di satu koleksi, kategori tambahan memakai tag).
- `collection_members` dan `link_shares`: berbagi ke email dengan peran `viewer` / `editor`. `user_id` kosong sampai penerima pertama kali masuk; `seen_at` dipakai untuk penanda "Baru".
- `links_fts` (FTS5): judul, deskripsi + nama situs, catatan, domain + URL, dan tag. Disinkronkan dari kode aplikasi karena tag ada di tabel lain.

## Hak akses

Sebuah link bisa dilihat kalau:

- milik sendiri,
- ada di koleksi yang dibagikan ke kita, atau
- dibagikan langsung ke kita.

Link bisa **diedit** oleh pemilik, editor koleksinya, atau penerima dengan peran `editor`. Pin, arsip, hapus, pindah koleksi, dan berbagi hanya bisa dilakukan pemilik.

## Keputusan desain

- **Magic link butuh satu ketukan.** `GET /auth/verify` hanya menampilkan tombol, dan token baru dipakai lewat `POST`. Pemindai email seperti Outlook Safe Links membuka link secara otomatis dan akan menghabiskan token sekali pakai kalau token langsung dipakai saat GET.
- **Pencarian selalu global.** Orang mencari justru karena lupa link itu ada di koleksi mana.
- **Link rusak** hanya ditandai saat mendapat 404/410 atau gagal 3 kali berturut-turut. Satu kali timeout atau blokir bot belum bukti halamannya hilang.
- **Batas subrequest free tier (50 per invocation).** Impor ribuan link hanya mengambil metadata 8 link pertama secara langsung; sisanya diproses bertahap oleh pekerjaan latar belakang.
- **SSRF.** URL ke `localhost`, IP privat atau link-local, dan `.local` / `.internal` ditolak. Setiap redirect (maks 5) dicek ulang.
- **CSRF.** Request yang mengubah data harus punya `Origin` yang sama dengan `APP_URL`; cookie sesi memakai `HttpOnly; Secure; SameSite=Lax`.
