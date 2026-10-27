# Memulai

Panduan menjalankan JanganLupa di komputer lokal.

## Prasyarat

- Node.js 22+
- npm 10+
- Python 3 (hanya untuk menjalankan test API)
- Login Wrangler (`npx wrangler login`) hanya diperlukan untuk deploy, tidak untuk development lokal.

## Setup

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # konfigurasi Cloudflare milikmu, di-ignore git
cp .dev.vars.example .dev.vars             # override lokal: APP_URL, mode email, APP_SECRET
npm run db:migrate:local
npm run dev
```

Buka `http://localhost:5173`.

`npm run dev` menjalankan Vite bersama Worker lewat `@cloudflare/vite-plugin`, jadi frontend, API, dan database D1 lokal (di `.wrangler/`) berjalan dalam satu proses.

## Login di lokal

`.dev.vars` mengatur `EMAIL_PROVIDER=console`, jadi email tidak dikirim:

- link masuk dan kode 6 digit dicetak di terminal sebagai `[mail] to=...`,
- halaman login juga menampilkan link dan kodenya langsung (hanya kalau `APP_URL` mengarah ke `localhost`).

Rate limit login tetap aktif di lokal (5 permintaan per email per 15 menit). Kalau terkena batas saat testing:

```bash
npx wrangler d1 execute janganlupa --local --command "DELETE FROM rate_limits"
```

## Test API

`tests/api_e2e.py` menjalankan ±60 skenario lewat HTTP: login magic link, duplikat, SSRF, pencarian, hak akses berbagi, link publik, ekspor, dan rate limit. Test memakai email tetap, jadi jalankan di database lokal yang masih kosong:

```bash
rm -rf .wrangler/state && npm run db:migrate:local
npm run dev            # terminal 1
npm run test:e2e       # terminal 2
```

Beberapa test membaca metadata dari situs sungguhan (github.com, example.com), jadi butuh koneksi internet.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server Vite + Worker dengan binding lokal |
| `npm run build` | Typecheck lalu build frontend dan Worker ke `dist/` |
| `npm run preview` | Build lalu jalankan hasil build secara lokal |
| `npm run deploy` | Build lalu deploy ke Cloudflare |
| `npm run typecheck` | Cek TypeScript untuk frontend dan Worker |
| `npm run test:e2e` | Test API end-to-end ke dev server |
| `npm run db:migrate:local` | Terapkan migrasi ke D1 lokal |
| `npm run db:migrate:remote` | Terapkan migrasi ke D1 production |
