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
| Smart contract | Solidity ^0.8.24, OpenZeppelin v5, Hardhat 3 + `hardhat-toolbox-mocha-ethers` | Test, script, dan deploy pakai ethers yang sama dengan app |
| Deploy contract | Hardhat Ignition + `hardhat-verify` | Deploy terkelola, alamat tersimpan otomatis |
| Typing contract | TypeChain (output dipakai frontend & backend) | Panggilan contract type-safe di ethers |
| Chain | Ethereum Sepolia | Sesuai PRD |
| Gasless | Relayer sendiri (ERC-2771 forwarder) + EIP-2612 permit | Pengguna tidak pernah bayar gas |
| Notifikasi | Resend (email) + tabel notifikasi in-app | Sederhana |
| OTP | Twilio Verify / provider lokal | Verifikasi HP |

## Canonical Payload (EIP-712)

```solidity
struct DebtNote {
    bytes32 noteId;          // uuid → bytes32
    uint32  version;
    address creditor;
    address debtor;
    uint256 principal;       // IDR, 18 desimal mengikuti token
    uint256 interestAmount;  // 0 jika tanpa bunga
    uint16  lateFeeBps;      // 0 (tidak disepakati) atau 200 (2% per 30 hari)
    bytes32 scheduleHash;    // keccak256(abi.encode(uint64[] dueDates, uint256[] amounts))
    bytes32 docHash;         // keccak256(abi.encodePacked(sorted fileHashes))
    uint8   disbursement;    // 0 = on-chain, 1 = off-chain
    uint256 nonce;           // acak 256-bit per versi, dibuat backend (unordered nonce)
    uint64  deadline;        // sama untuk kedua pihak, ditetapkan backend di typed-data
}

struct OffchainPayment {     // ditandatangani kreditur saat konfirmasi bayar off-chain
    uint256 tokenId;
    bytes32 paymentId;       // uuid payment → bytes32
    uint256 amount;
    uint256 nonce;           // acak 256-bit per konfirmasi (unordered nonce)
    uint64  deadline;
}
```

Jadwal lengkap (`dueDates[]`, `amounts[]`, Σ = `principal + interestAmount`, maks 24 cicilan) dikirim terpisah ke `mintNote` dan dicocokkan dengan `scheduleHash`. Jatuh tempo akhir = `dueDates[last]`.

Kedua pihak menandatangani struct yang **identik** (termasuk `nonce` dan `deadline`), sehingga `termsHash` yang diverifikasi contract sama untuk dua signature.

**Unordered nonce:** nonce tidak berurutan, melainkan angka acak yang ditandai terpakai per signer (`usedNonces[signer][nonce]`). Dengan begitu satu wallet bisa punya banyak piutang yang menunggu tanda tangan / pencairan dan banyak konfirmasi bayar sekaligus, tanpa saling membatalkan. Saat `mintNote`, nonce yang sama ditandai terpakai untuk kreditur **dan** debitur.

Domain: `{ name: "PiutangChain", version: "1", chainId: 11155111, verifyingContract: <PiutangNote> }`.

## Hashing

1. Setiap file → `keccak256(fileBytes)` saat upload, disimpan di `documents.file_hash`.
2. `docHash = keccak256(abi.encodePacked(sorted(fileHashes)))`.
3. `scheduleHash = keccak256(abi.encode(dueDates[], amounts[]))`; `dueDates` = 00:00 WIB tanggal jatuh tempo dalam unix timestamp (UTC).
4. `termsHash = EIP-712 struct hash DebtNote` → disimpan on-chain sebagai bukti isi perjanjian.

Data pribadi (nama, HP, email) **tidak** masuk payload.

## Konvensi

- Nominal disimpan sebagai `NUMERIC(78,0)` (wei-like) di DB, `uint256` di contract.
- Semua waktu dalam UTC; UI menampilkan WIB.
- Late fee: 2% per 30 hari, pro-rata, dari cicilan terlambat (detail rumus di [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md#late-fee-2-per-bulan)). Bunga (`interest_type` percent/flat) dikonversi ke `interestAmount` saat draft dan sudah termasuk di jadwal cicilan.
- ID: UUID v7 di DB; `noteId = keccak256(uuid)` on-chain.
- Istilah UI: "Tanda tangan" bukan "sign transaction", "Bukti digital" bukan "NFT".

Lihat [06-ARCHITECTURE](06-ARCHITECTURE.md) dan [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md).
