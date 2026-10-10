# PiutangChain Web3

Full-stack Next.js (App Router) untuk PiutangChain: UI + API + relayer gasless, terhubung ke kontrak di **Ethereum Sepolia** (`piutangchain-contracts/deployments/sepolia.json`).

| Bagian | Isi |
|---|---|
| UI | Landing, Masuk (MetaMask/SIWE), Dashboard, Piutang saya (cari/filter/urut), Buat & ubah draft, Detail piutang, Tanda tangan, Chat, Profil |
| API | `src/app/api/**`: auth SIWE, profil + OTP, faucet IDRX, draft, dokumen, tanda tangan EIP-712, escrow & aktivasi, pembayaran on-chain (forwarder) + fee aplikasi, sengketa, integrity check, chat |
| Relayer | `src/lib/chain/relayer.ts`: satu wallet membayar gas semua transaksi, antrean in-process, estimasi gas +30% |
| DB | Prisma + PostgreSQL (Supabase), dev maupun produksi. File upload disimpan di DB (bytea) |

## Menjalankan

```bash
npm install
```

```bash
cp .env.example .env
```

Isi `.env`: `DATABASE_URL` (Supabase "Transaction pooler", port 6543, `?pgbouncer=true&connection_limit=5`), `DIRECT_URL` (Supabase "Direct connection" atau "Session pooler", port 5432), `SESSION_SECRET` (string acak ≥32 karakter) dan `RELAYER_PRIVATE_KEY` (wallet ber-Sepolia ETH; harus owner MockIDRX + `ADMIN_ROLE` supaya faucet dan auto-freeze jalan). Di development, kalau `RELAYER_PRIVATE_KEY` kosong, server memakai `DEPLOYER_PRIVATE_KEY` dari `piutangchain-contracts/.env`. Untuk fee aplikasi isi `APP_FEE_WALLET` (wallet penampung) dan `APP_FEE_BPS` (basis poin, default `100` = 1%); kosongkan `APP_FEE_WALLET` untuk menonaktifkan.

Terapkan migrasi (pakai `migrate deploy`, bukan `db push`: migrasi 0002 berisi unique index parsial untuk nomor HP yang tidak bisa ditulis di `schema.prisma`):

```bash
npx prisma migrate deploy
```

```bash
npm run dev
```

Kalau muncul `the URL must start with the protocol file:`, berarti Prisma Client masih hasil schema SQLite lama (branch yang dibuat sebelum pindah ke Postgres). Merge `origin/main`, jalankan `npx prisma generate`, lalu restart dev server.

Buka http://localhost:3000, masuk dengan MetaMask di jaringan Sepolia, verifikasi nomor HP di Profil (mode development: kode OTP tampil di layar), ambil IDRX uji dari faucet, lalu buat surat piutang. Pihak lawan masuk dengan wallet yang kamu undang.

## Tes end-to-end

Dengan dev server jalan, script ini memakai dua wallet acak sebagai kreditur dan debitur dan menjalankan seluruh alur di Sepolia (login, faucet, escrow, aktivasi, bayar gasless, chat, cek integritas, sengketa, tamper → beku, pencairan off-chain, tandai lunas):

```bash
node scripts/e2e-api.mjs
```

## Setelah kontrak di-deploy ulang

```bash
npm run sync-contracts
```

Menyalin ABI + alamat dari `piutangchain-contracts` ke `src/lib/chain/deployment.json`.

## Belum ada

- Login email/Google (embedded wallet): perlu `PRIVY_APP_ID`.
- Pengiriman SMS OTP dan email pengingat: titik sambungnya di `src/app/api/me/otp/route.ts`.
- Antrean relayer persisten (BullMQ/Redis): sekarang in-process, cukup untuk satu instance server.
- Menu admin terpisah: admin (wallet `ADMIN_ROLE`) menutup sengketa dan membuka pembekuan dari halaman detail piutang.
