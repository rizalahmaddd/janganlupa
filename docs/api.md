# REST API

Semua endpoint ada di bawah `/api` dan mengembalikan JSON. Autentikasi memakai cookie sesi `jl_session` yang dipasang saat login. Request selain `GET` harus dikirim dari origin yang sama (cek header `Origin`).

Error selalu berbentuk `{ "error": "pesan untuk user", "code": "kode_mesin" }` dengan status HTTP yang sesuai (`400`, `401`, `403`, `404`, `409`, `410`, `429`).

## Auth

| Method | Path | Body | Keterangan |
|---|---|---|---|
| POST | `/auth/request` | `{ email, redirect? }` | Kirim magic link + kode 6 digit |
| POST | `/auth/verify` | `{ token }` | Masuk dengan token dari link |
| POST | `/auth/code` | `{ email, code }` | Masuk dengan kode (maks 5 percobaan per token) |
| POST | `/auth/logout` | | Keluar dari perangkat ini |

## Akun

| Method | Path | Keterangan |
|---|---|---|
| GET / PATCH / DELETE | `/me` | Profil, `{ name, settings: { theme, view } }`, hapus akun dengan `{ confirm: email }` |
| GET | `/sessions` | Perangkat yang sedang masuk |
| DELETE | `/sessions/:id` | Keluarkan satu perangkat, atau `others` untuk semua kecuali yang ini |
| GET | `/stats` | Jumlah per tampilan, termasuk `shared` dan `shared_new` |

## Link

| Method | Path | Keterangan |
|---|---|---|
| GET | `/links` | Query: `view` (`all`, `shared`, `lupa`, `pinned`, `unread`, `archive`, `trash`, `broken`), `collection`, `tag`, `domain`, `q`, `sort`, `cursor` |
| POST | `/links` | `{ url, title?, note?, tags?, collectionId? }`. `409` + `link` kalau sudah tersimpan |
| POST | `/links/bulk` | `{ text, tags?, collectionId? }`: ambil semua URL dari teks |
| POST | `/links/batch` | `{ ids, action, value? }`: `pin`, `archive`, `delete`, `restore`, `purge`, `move`, `tag`, `untag`, ... |
| GET / PATCH / DELETE | `/links/:id` | `DELETE ?permanent=1` untuk hapus permanen dari sampah |
| POST | `/links/:id/restore` | Pulihkan dari sampah |
| POST | `/links/:id/refresh` | Ambil ulang judul dan thumbnail |
| POST | `/links/:id/open` | Catat bahwa link dibuka |
| GET | `/links/:id/related` | Link yang berkaitan |
| POST | `/links/:id/copy` | Simpan salinan link yang dibagikan ke link sendiri |

## Berbagi

| Method | Path | Keterangan |
|---|---|---|
| GET | `/links/:id/shares` | Daftar penerima (pemilik saja) |
| POST | `/links/:id/shares` | `{ emails: [...], role: "viewer" \| "editor", message? }` |
| DELETE | `/links/:id/shares/:email` | Pemilik mencabut akses, atau penerima menghapus dari "Dibagikan ke saya" |
| GET / POST | `/collections/:id/members` | Daftar / undang `{ email, role }` |
| DELETE | `/collections/:id/members/:email` | Cabut akses |
| POST | `/collections/:id/leave` | Keluar dari koleksi orang lain |
| POST | `/collections/:id/public` | `{ enabled?, regenerate? }`: link publik |
| POST | `/shared/seen` | Tandai semua yang dibagikan sudah dilihat |
| GET | `/public/:slug` | Isi koleksi publik, tanpa login |

## Lainnya

| Method | Path | Keterangan |
|---|---|---|
| GET / POST / PATCH / DELETE | `/collections[/:id]` | Koleksi. `DELETE ?links=delete` sekaligus memindahkan link ke sampah |
| GET / PATCH / DELETE | `/tags[/:id]` | Ganti nama ke tag yang sudah ada akan menggabungkannya |
| GET | `/domains` | Situs yang paling sering disimpan |
| POST | `/import` | `multipart/form-data` dengan field `file` (.html, .json, .txt) |
| GET | `/export?format=html\|json\|csv` | Unduh semua link |
| GET | `/img?u=&s=` | Proxy gambar bertanda tangan HMAC |
| GET | `/jobs?token=` | Jalankan pekerjaan latar belakang (butuh secret `JOB_TOKEN`) |
| GET | `/health` | `{ "ok": true }` |
