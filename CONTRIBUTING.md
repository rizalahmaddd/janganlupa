# Berkontribusi

Terima kasih sudah tertarik berkontribusi ke JanganLupa!

## Alur

1. Buka issue dulu untuk perubahan besar, supaya arahnya disepakati sebelum mulai coding.
2. Fork repo, buat branch dari `main`.
3. Jalankan project di lokal mengikuti [docs/getting-started.md](./docs/getting-started.md).
4. Pastikan semua cek lolos sebelum membuat pull request:

   ```bash
   npm run typecheck
   npm run build
   npm run test:e2e   # butuh dev server yang sedang jalan dengan database lokal yang masih kosong
   ```

5. Perubahan skema database ditulis sebagai file baru di `migrations/` (misalnya `0003_nama_perubahan.sql`). Jangan mengubah file migrasi yang sudah ada.

## Panduan kode

- TypeScript strict, tanpa `any` implisit.
- Teks yang terlihat user memakai Bahasa Indonesia.
- Tulis komentar hanya untuk menjelaskan *alasan*, bukan mengulang apa yang dilakukan kode.
- Ubahan UI dicek di tiga ukuran: desktop (≥1200px), tablet (768–1199px), dan HP (<768px). Ketiganya punya komponen tata letak sendiri di `src/layouts/`.
- Batas free tier Cloudflare Workers (50 subrequest dan 10 ms CPU per request) ikut diperhitungkan, terutama untuk pekerjaan latar belakang.
- Jangan pernah meng-commit secret, `.dev.vars`, atau `wrangler.jsonc` milikmu.

## Melaporkan bug

Gunakan template **Laporan bug** saat membuat issue. Untuk celah keamanan, ikuti [SECURITY.md](./SECURITY.md).
