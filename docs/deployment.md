# Deploy ke Cloudflare

JanganLupa berjalan di satu Cloudflare Worker: API (Hono) dan frontend statis (Workers Static Assets) dalam satu deploy, dengan D1 sebagai database. Semua bagian muat di **free tier** dan tidak membutuhkan R2 maupun kartu kredit.

`wrangler.jsonc` berisi konfigurasi akun Cloudflare-mu (ID database, domain, email pengirim) dan sengaja di-ignore git. Repo hanya menyimpan templatenya, `wrangler.example.jsonc`.

## 1. Buat database

```bash
npx wrangler login
npx wrangler d1 create janganlupa
```

## 2. Isi `wrangler.jsonc`

Salin dari template kalau belum ada:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Lalu sesuaikan:

- `d1_databases[0].database_id`: dari output `wrangler d1 create` di atas.
- `vars.APP_URL`: URL publik aplikasi, misalnya `https://janganlupa.example.com`. Dipakai untuk link di email dan pemeriksaan Origin.
- `vars.EMAIL_FROM`: alamat pengirim, misalnya `JanganLupa <noreply@example.com>`. Domainnya harus terverifikasi di Resend.
- `vars.EMAIL_PROVIDER`: `resend` (disarankan), `cloudflare` (binding `send_email`), atau `console` (hanya untuk lokal).
- `routes`: aktifkan kalau memakai custom domain. Zona domain harus ada di akun Cloudflare yang sama.
- `account_id`: tambahkan kalau Wrangler-mu login ke lebih dari satu akun.

## 3. Pasang secret

Secret tidak pernah disimpan di repo atau di `wrangler.jsonc`:

```bash
npx wrangler secret put APP_SECRET       # string acak: openssl rand -base64 32 (menandatangani URL proxy gambar)
npx wrangler secret put RESEND_API_KEY   # dari dashboard Resend, permission "Sending access"
npx wrangler secret put JOB_TOKEN        # opsional, string acak untuk GET /api/jobs
```

## 4. Migrasi lalu deploy

Selalu jalankan migrasi **sebelum** deploy. Kode baru bisa bergantung pada tabel baru.

```bash
npm run db:migrate:remote
npm run deploy
```

## Pekerjaan latar belakang

Ada empat tugas yang berjalan di latar belakang:

- mengambil ulang judul dan thumbnail yang gagal dibaca (maksimal 3 kali, dengan jeda),
- mengecek ulang link yang tersimpan setiap 7 hari untuk menandai link rusak,
- menghapus permanen isi sampah yang lebih dari 30 hari,
- membersihkan token login, sesi, dan data rate limit yang kedaluwarsa.

Free plan membatasi **5 cron trigger per akun**, jadi JanganLupa tidak bergantung pada cron:

1. **Otomatis dari traffic:** setiap request API bisa memicu tugas latar belakang, paling sering sekali per 10 menit. Klaim jadwalnya atomik di D1, jadi tidak pernah dobel.
2. **Pinger eksternal (opsional):** supaya tetap jalan saat aplikasi sepi, panggil `https://<domain>/api/jobs?token=<JOB_TOKEN>` setiap 10 menit, misalnya lewat cron-job.org.
3. **Cron trigger (opsional):** kalau akunmu masih punya slot, aktifkan `triggers.crons` di `wrangler.jsonc`.

## Fitur yang bisa dimatikan

`shared/features.ts` berisi flag fitur. Pengingat via email (`reminders`) saat ini dimatikan. Ubah ke `true`, lalu deploy ulang untuk mengaktifkannya.

## Checklist setelah deploy

- Buka `/login`, minta link masuk, dan pastikan email diterima.
- Simpan satu link dan pastikan judul serta thumbnail muncul dalam beberapa detik.
- Buka `/panduan` dan `/manifest.webmanifest` untuk memastikan aset statis tersaji.
- `GET /api/health` mengembalikan `{"ok":true}`.
