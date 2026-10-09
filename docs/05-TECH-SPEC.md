# 05 — Technical Specification

> PRD tidak menetapkan stack. Pilihan di bawah adalah **usulan** untuk MVP hackathon dan bisa diganti.

## Stack

| Layer | Pilihan | Alasan |
|-------|---------|--------|
| Frontend | Next.js (App Router) + TypeScript + Tailwind | Cepat, SSR, deploy mudah |
| Wallet | ethers.js v6 (`BrowserProvider`, `signTypedData`) + Reown AppKit adapter ethers (MetaMask, WalletConnect) | Satu library untuk frontend dan backend |
| Chain client backend | ethers.js v6 (`JsonRpcProvider`, `Wallet`, `NonceManager`, `verifyTypedData`) | Relayer, indexer, verifikasi signature |
| Embedded wallet | Privy / Web3Auth (login email & Google) | Pengguna awam tanpa seed phrase |
| Auth | SIWE (EIP-4361) + session JWT httpOnly | Tanpa password |
| Backend | Node.js (NestJS atau Next.js route handlers) | Satu bahasa dengan frontend |
| Database | PostgreSQL (Supabase) + Prisma ORM (schema, migrate, seed) | Relasional, type-safe, cocok untuk audit |
| Storage | Supabase Storage / S3, enkripsi AES-256 | Dokumen off-chain |
| Queue | BullMQ + Redis | Antrean relayer, retry, cron |
| Smart contract | Solidity 0.8.28, Hardhat 2 + `@nomicfoundation/hardhat-toolbox` (ethers v6, Mocha/Chai), **tanpa OpenZeppelin** | Kode di `piutangchain-contracts/`; test, script, dan deploy pakai ethers yang sama dengan app |
| Deploy contract | `scripts/deploy.js` (`npm run deploy:sepolia`) → `deployments/<network>.json` | Alamat dan constructor args tersimpan untuk backend/frontend |
| Typing contract | TypeChain (bawaan hardhat-toolbox) | Panggilan contract type-safe di ethers |
| Stablecoin testnet | `MockIDRX`, **2 desimal** | Rp1 = 100 satuan terkecil |
| Chain | Ethereum Sepolia | Sesuai PRD |
| Gasless | Relayer sendiri (ERC-2771 forwarder) + EIP-2612 permit | Pengguna tidak pernah bayar gas |
| Notifikasi | Resend (email) + tabel notifikasi in-app | Sederhana |
| OTP | Twilio Verify / provider lokal | Verifikasi HP |

## Canonical Payload (EIP-712)

Struct yang ditandatangani mengikuti kode (`piutangchain-contracts/contracts/DebtTypes.sol`); detail field dan aturannya di [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md#struct-yang-ditandatangani-eip-712). Ringkasnya:

| Struct | Ditandatangani | Kapan |
|--------|----------------|-------|
| `Note` | kreditur **dan** debitur (pesan identik) | Saat setuju isi perjanjian |
| `DisbursementReceipt` | debitur | Pencairan off-chain: konfirmasi terima dana |
| `PaymentConfirmation` | kreditur | Konfirmasi pembayaran off-chain |
| `Amendment` | kreditur dan debitur | Revisi setelah aktif |
| `ForwardRequest` (domain `PiutangForwarder`) | pengguna | Aksi gasless lewat forwarder |
| `Permit` (domain `Mock IDRX`) | pemilik token | Setor escrow / bayar on-chain |

Domain `Note` dkk.: `{ name: "PiutangChain", version: "1", chainId: 11155111, verifyingContract: <DebtManager> }`. Backend dan frontend **wajib** memakai `piutangchain-contracts/helpers/eip712.js`.

**Nonce unordered:** `creditorNonce`, `debtorNonce`, dan `nonce` di struct lain adalah angka acak 256-bit yang dibuat backend dan ditandai terpakai per signer (`nonceUsed[signer][nonce]`). Banyak piutang dan konfirmasi dari wallet yang sama bisa berjalan paralel. Nonce `DisbursementReceipt` harus berbeda dari `debtorNonce`.

Jadwal cicilan (`Schedule { dueDates[], amounts[] }`, maks 24, Σ = `totalOwed`, tanggal terakhir = `dueDate`) tidak ditandatangani langsung; contract mencocokkannya dengan `scheduleHash`.

## Hashing

> **Disepakati** tim backend pada 9 Okt 2026. Integrity checker dan endpoint tanda tangan wajib memakai rumus ini; perubahan rumus = perubahan `docHash` untuk semua piutang baru.

1. Setiap file → `keccak256(fileBytes)` saat upload, disimpan di `documents.file_hash`.
2. `payloadHash = keccak256(canonical JSON field off-chain)`: judul, jenis utang, tipe/nilai bunga, catatan jaminan, metode pencairan, versi. Canonical JSON = key diurutkan, tanpa spasi, nominal sebagai string.
3. `docHash = keccak256(abi.encodePacked(payloadHash, sorted(fileHashes)))` → field `Note.docHash`, dicek ulang dengan `verifyHash(noteId, docHash)`.
4. `scheduleHash = keccak256(abi.encode(uint64[] dueDates, uint256[] amounts))` (helper `E.scheduleHash`); `dueDates` = 00:00 WIB tanggal jatuh tempo dalam unix timestamp.
5. Field nominal (`principal`, `totalOwed`, `lateFeeBps`, `dueDate`, pihak) tersimpan langsung on-chain; integrity checker membandingkannya dengan DB lewat `getNote()`.

Data pribadi (nama, HP, email) **tidak** masuk canonical payload, jadi tidak ikut di-hash dan tidak pernah ada di blockchain.

## Konvensi

- Nominal disimpan sebagai `NUMERIC(78,0)` dalam **satuan terkecil token** (MockIDRX 2 desimal: Rp1 = 100) di DB, `uint256` di contract. Desimal dibaca dari `deployments/<network>.json` (`stablecoinDecimals`).
- Semua waktu dalam UTC; UI menampilkan WIB.
- Late fee: 2% per 30 hari, pro-rata, dari cicilan terlambat (detail rumus di [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md#denda-2-per-bulan)). Bunga (`interest_type` percent/flat) dihitung backend saat draft; `totalOwed` = pokok + bunga dan sudah termasuk di jadwal cicilan.
- ID: UUID v7 di DB; `noteId = keccak256(uuid)` on-chain; `tokenId = uint256(noteId)`.
- Istilah UI: "Tanda tangan" bukan "sign transaction", "Bukti digital" bukan "NFT".

Lihat [06-ARCHITECTURE](06-ARCHITECTURE.md) dan [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md).
