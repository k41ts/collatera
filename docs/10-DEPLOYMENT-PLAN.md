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
   cd piutangchain-contracts && npm run deploy:sepolia
   ```
   `scripts/deploy.js` men-deploy `MockIDRX` → `PiutangForwarder` → `DebtNote` → `DebtManager(debtNote, idrx, forwarder, admin)`, lalu `DebtNote.setManager(DebtManager)`. Alamat, desimal, dan constructor args tersimpan di `deployments/sepolia.json`.
2. **Role:** `ADMIN_ADDRESS` mendapat `DEFAULT_ADMIN_ROLE` + `ADMIN_ROLE` (default deployer; pakai multisig untuk produksi). `FREEZER_ADDRESS` (key integrity checker) mendapat `FREEZER_ROLE` otomatis jika admin = deployer; selain itu admin melakukan `grantRole` manual. Tidak ada role untuk relayer.
3. **Verifikasi** di Sepolia Etherscan: `npx hardhat verify --network sepolia <alamat> <args>` (args dari `deployments/sepolia.json`); salin alamat ke env frontend & backend.
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
| `DEBT_MANAGER_ADDRESS`, `DEBT_NOTE_ADDRESS`, `MOCK_IDRX_ADDRESS`, `FORWARDER_ADDRESS` | backend, worker (frontend memakai versi `NEXT_PUBLIC_*`) |
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_DEBT_MANAGER_ADDRESS`, `NEXT_PUBLIC_MOCK_IDRX_ADDRESS`, `NEXT_PUBLIC_FORWARDER_ADDRESS` | frontend |
| `DEPLOYER_PRIVATE_KEY`, `ADMIN_ADDRESS`, `FREEZER_ADDRESS` | `scripts/deploy.js` (lihat `piutangchain-contracts/.env.example`) |
| `RELAYER_PRIVATE_KEY` | relayer worker (secret) |
| `APP_FEE_WALLET`, `APP_FEE_BPS` | backend: wallet penampung fee aplikasi dan tarifnya dalam basis poin (default `100` = 1%, maks `1000`). `APP_FEE_WALLET` kosong = fee nonaktif |
| `FREEZER_PRIVATE_KEY` | integrity checker, hanya untuk `freeze` (secret) |
| `IDRX_OWNER_PRIVATE_KEY` | backend faucet: `MockIDRX.mint` (secret, testnet saja) |
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
- [ ] Faucet MockIDRX bisa diklaim.
- [ ] Buat draft → undang → dua tanda tangan → token ter-mint.
- [ ] Bayar cicilan on-chain → sisa utang berkurang.
- [ ] Integrity check menghasilkan VERIFIED.

## Rollback

- Frontend/backend: redeploy versi sebelumnya dari platform.
- Contract: `pause()` via multisig, deploy versi baru, arahkan env ke alamat baru. Data testnet lama dibiarkan.

## Monitoring

- Log error backend (Sentry), status antrean BullMQ, saldo relayer, lag indexer (block terakhir diproses).
