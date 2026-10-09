# PiutangChain

Surat piutang (promissory note) on-chain: dibuat, ditandatangani kedua pihak, ditokenisasi, dan ditagih sampai lunas, tanpa pengguna perlu paham crypto atau membayar gas.

## Fitur

- Login wallet (SIWE) atau email/Google (embedded wallet) + verifikasi OTP
- Draft, undangan, revisi, dan tanda tangan EIP-712 gasless
- Token ERC-721 non-transferable ke wallet kreditur sebagai hak tagih
- Pencairan pokok lewat escrow stablecoin atau transfer off-chain
- Cicilan, pembayaran on-chain (MockIDR) dan off-chain dengan konfirmasi kreditur
- OVERDUE otomatis per cicilan, late fee 2%/bulan (jika disepakati), pengingat H-3 & H-0
- Integrity checker: hash DB vs on-chain → TAMPERED → FROZEN
- Dispute ke admin dan audit log

## Struktur Repo (usulan)

```
apps/
  web/          Next.js frontend
  api/          Backend API + worker (relayer, cron, indexer)
packages/
  contracts/    Hardhat: PiutangNote, MockIDR, Forwarder (+ TypeChain types)
  shared/       Tipe, skema Zod, helper EIP-712
docs/           01-PRD … 14-README
```

## Menjalankan Lokal

Prasyarat: Node 22+, pnpm, Docker.

```bash
pnpm install
```

```bash
docker compose up -d postgres redis
```

```bash
pnpm --filter contracts exec hardhat node
```

```bash
pnpm --filter contracts deploy:local
```

```bash
pnpm --filter api db:migrate && pnpm --filter api db:seed
```

```bash
pnpm dev
```

Salin `.env.example` ke `.env` lalu isi nilainya (lihat [10-DEPLOYMENT-PLAN](10-DEPLOYMENT-PLAN.md)).

## Test

```bash
pnpm --filter contracts test
```

```bash
pnpm test
```

## Dokumentasi

| # | Dokumen |
|---|---------|
| 01 | [PRD](01-PRD.md) |
| 02 | [User Flow](02-USER-FLOW.md) |
| 03 | [Business Rules](03-BUSINESS-RULES.md) |
| 04 | [Role Matrix](04-ROLE-MATRIX.md) |
| 05 | [Tech Spec](05-TECH-SPEC.md) |
| 06 | [Architecture](06-ARCHITECTURE.md) |
| 07 | [ERD](07-ERD.md) |
| 08 | [API Spec](08-API-SPEC.md) |
| 09 | [Security](09-SECURITY.md) |
| 10 | [Deployment Plan](10-DEPLOYMENT-PLAN.md) |
| 11 | [Blockchain Spec](11-BLOCKCHAIN-SPEC.md) |
| 12 | [Testing Plan](12-TESTING-PLAN.md) |
| 13 | [Demo Flow](13-DEMO-FLOW.md) |

## Catatan

Prototipe hackathon di **Sepolia testnet**. Platform diposisikan sebagai alat pencatatan perjanjian antar pihak yang saling kenal, bukan marketplace pinjaman. Perlu kajian hukum (OJK, UU ITE, UU PDP) sebelum rilis publik.
