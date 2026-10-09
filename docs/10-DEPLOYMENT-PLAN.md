# 10 — Deployment Plan

Target: **Ethereum Sepolia testnet** (mainnet out of scope).

## Environment

| Env | Chain | Frontend | Backend | DB |
|-----|-------|----------|---------|----|
| Local | Hardhat Network (`npx hardhat node`) | `localhost:3000` | `localhost:4000` | Postgres Docker / Supabase local |
| Staging | Sepolia | Vercel preview | Railway / Fly.io | Supabase project staging |
| Demo | Sepolia | Vercel production | Railway / Fly.io | Supabase project demo |

## Urutan Deploy

1. **Contract**
   ```bash
   npx hardhat ignition deploy ignition/modules/PiutangChain.ts --network sepolia --verify
   ```
   Urutan di module Ignition: `MockIDR` → `Forwarder` → `PiutangNote(forwarder, mockIDR)`. Alamat otomatis tersimpan di `ignition/deployments/chain-11155111/deployed_addresses.json`.
2. **Grant role:** `RELAYER_ROLE` ke wallet relayer, `GUARDIAN_ROLE` ke wallet integrity service dan wallet admin (sesuai [04-ROLE-MATRIX](04-ROLE-MATRIX.md)), `MINTER_ROLE` MockIDR ke wallet relayer (untuk faucet gasless).
3. **Verifikasi** di Sepolia Etherscan (sudah lewat flag `--verify`); salin alamat ke env frontend & backend.
4. **Database:** `npx prisma migrate deploy`, lalu `npx prisma db seed` untuk akun admin.
5. **Backend + worker:** deploy API, relayer worker, cron worker, indexer (start block = block deploy).
6. **Frontend:** set alamat contract + env publik, deploy.
7. **Danai relayer** dengan Sepolia ETH dari faucet; set alert saldo < 0.05 ETH.
8. **Smoke test** (lihat bawah).

## Environment Variables

| Variabel | Dipakai oleh |
|----------|--------------|
| `SEPOLIA_RPC_URL` | backend, worker, script |
| `CHAIN_ID=11155111` | semua |
| `PIUTANG_NOTE_ADDRESS`, `MOCK_IDR_ADDRESS`, `FORWARDER_ADDRESS` | backend, worker (frontend memakai versi `NEXT_PUBLIC_*`) |
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_PIUTANG_NOTE_ADDRESS`, `NEXT_PUBLIC_MOCK_IDR_ADDRESS`, `NEXT_PUBLIC_FORWARDER_ADDRESS` | frontend |
| `RELAYER_PRIVATE_KEY` | relayer worker (secret) |
| `GUARDIAN_PRIVATE_KEY` | cron worker / integrity service (secret) |
| `DATABASE_URL`, `REDIS_URL` | backend, worker |
| `JWT_SECRET`, `STORAGE_ENC_KEY` | backend (secret) |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_WALLETCONNECT_ID` | frontend |
| `PRIVY_APP_SECRET` | backend (secret, verifikasi token Privy) |
| `RESEND_API_KEY`, `OTP_PROVIDER_KEY` | backend (secret) |
| `ETHERSCAN_API_KEY` | script verify |

## CI/CD (GitHub Actions)

- PR: lint, typecheck, `npx hardhat test`, unit test backend, build frontend.
- Merge ke `main`: deploy staging otomatis.
- Tag `demo-*`: deploy demo (contract tidak di-redeploy kecuali ada perubahan).

## Smoke Test Setelah Deploy

- [ ] Login SIWE dan login email (embedded wallet) berhasil.
- [ ] Faucet MockIDR bisa diklaim.
- [ ] Buat draft → undang → dua tanda tangan → token ter-mint.
- [ ] Bayar cicilan on-chain → sisa utang berkurang.
- [ ] Integrity check menghasilkan VERIFIED.

## Rollback

- Frontend/backend: redeploy versi sebelumnya dari platform.
- Contract: `pause()` via multisig, deploy versi baru, arahkan env ke alamat baru. Data testnet lama dibiarkan.

## Monitoring

- Log error backend (Sentry), status antrean BullMQ, saldo relayer, lag indexer (block terakhir diproses).
