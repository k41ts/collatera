# 08 — API Specification

Base URL: `/api/v1` · Format: JSON · Auth: cookie `session` (JWT httpOnly) hasil SIWE.
Semua endpoint `/notes/:id/*` hanya untuk kreditur/debitur piutang itu (atau admin saat piutang DISPUTED/FROZEN, lihat [04-ROLE-MATRIX](04-ROLE-MATRIX.md)).
Nominal dikirim sebagai string rupiah utuh (mis. `"5000000"`); backend mengonversi ke satuan terkecil MockIDRX (2 desimal: `× 100`) sebelum disimpan dan dikirim ke contract.

Aksi on-chain yang dilakukan pengguna sendiri (bayar, dispute, markPaid, refund, aksi admin) dikirim sebagai `forwardRequest: { from, to, gas, nonce, deadline, data, signature }` yang ditandatangani pengguna untuk `PiutangForwarder`; backend memeriksa `data` cocok dengan aksi dan piutangnya sebelum relayer memanggil `execute`.

## Auth

| Method | Path | Body | Keterangan |
|--------|------|------|------------|
| GET | `/auth/nonce` | — | Nonce SIWE, berlaku 5 menit |
| POST | `/auth/verify` | `{ message, signature }` | Verifikasi SIWE, set session |
| POST | `/auth/logout` | — | Hapus session |
| POST | `/auth/otp/send` | `{ phone }` | Kirim OTP |
| POST | `/auth/otp/verify` | `{ phone, code }` | Tandai HP terverifikasi |
| GET | `/me` | — | Profil + status verifikasi |
| POST | `/faucet` | — | Testnet saja: backend memanggil `MockIDRX.mint(user, jumlah)` dengan key owner (deployer), maks 1x per 24 jam per user. (`faucet()` di contract memakai `msg.sender`, jadi tidak gasless) |

## Surat Piutang

| Method | Path | Keterangan |
|--------|------|------------|
| POST | `/notes` | Buat draft (`role: creditor|debtor`) |
| GET | `/notes?role=&status=` | Daftar piutang milik user |
| GET | `/notes/:id` | Detail + versi aktif + cicilan + pembayaran |
| PATCH | `/notes/:id` | Edit draft (hanya DRAFT) |
| POST | `/notes/:id/documents` | Upload dokumen (multipart, maks 10 MB, PDF/JPG/PNG) |
| POST | `/notes/:id/invite` | `{ wallet? }` → link undangan |
| POST | `/invites/:token/accept` | Pihak lawan bergabung |
| POST | `/notes/:id/revise` | Buat versi baru, batalkan signature lama |
| POST | `/notes/:id/reject` | `{ reason }` → REJECTED |
| POST | `/notes/:id/cancel` | → CANCELLED |
| GET | `/notes/:id/typed-data` | Payload EIP-712 `Note` + `Schedule` (dan typed data permit untuk kreditur jika pencairan on-chain) |
| POST | `/notes/:id/sign` | `{ signature, permit? }` → simpan signature. Kreditur on-chain: enqueue `depositEscrow`. Jika dua signature lengkap: on-chain → enqueue `activateOnchain`; off-chain → AWAITING_DISBURSEMENT |
| GET | `/notes/:id/receipt/typed-data` | Payload `DisbursementReceipt` untuk debitur (pencairan off-chain) |
| POST | `/notes/:id/confirm-disbursement` | Debitur `{ signature, proofHash }` (hanya AWAITING_DISBURSEMENT) → enqueue `activateOffchain` → ACTIVE |
| POST | `/notes/:id/escrow/refund` | Kreditur `{ forwardRequest }` → `refundEscrow` (juga dipicu saat cancel/reject/revisi) |
| POST | `/notes/:id/amendments` | Revisi setelah aktif: `{ signature }` per pihak; jika dua lengkap → enqueue `amend` |
| POST | `/notes/:id/mark-paid` | Kreditur `{ forwardRequest }` → `markPaid` (mengikhlaskan sisa) |

## Pembayaran

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/notes/:id/outstanding` | Sisa utang, tunggakan, denda berjalan (dibaca dari `remaining()`, `overdueAmount()`, `lateFeeOf()`) |
| GET | `/notes/:id/repay/typed-data?amount=` | Typed data permit MockIDRX + domain & `nonce` PiutangForwarder + `deadline` (lihat [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md#gasless)) |
| POST | `/notes/:id/payments/onchain` | `{ amount, installmentIndex, permit: { deadline, v, r, s }, forwardRequest }` → backend cek `data` = `payOnchain(noteId, amount, installmentIndex, permit)` → enqueue `PiutangForwarder.execute`. `amount` = batas maksimal; contract hanya menarik sisa utang |
| POST | `/notes/:id/payments/offchain` | Multipart `{ amount, proof }` → PENDING |
| GET | `/payments/:id/typed-data` | Payload EIP-712 `PaymentConfirmation` (noteId, amount, proofHash, installmentIndex, nonce, deadline, settleFull) untuk konfirmasi kreditur. `settleFull=true` dipakai untuk pelunasan penuh: sisa denda kecil (≤ denda 1 hari) dihapus kontrak, supaya konfirmasi senilai sisa utang saat tanda tangan tetap melunasi walau dieksekusi beberapa detik kemudian |
| POST | `/payments/:id/confirm` | Kreditur `{ signature }` → enqueue `recordOffchainPayment` → CONFIRMED setelah event `PaymentRecorded` |
| POST | `/payments/:id/reject` | Kreditur `{ reason }` → REJECTED |

## Integrity, Dispute, Admin

| Method | Path | Keterangan |
|--------|------|------------|
| POST | `/notes/:id/integrity-check` | Hitung ulang → `VERIFIED|TAMPERED` |
| POST | `/notes/:id/disputes` | `{ reason, evidence[], forwardRequest }` → `openDispute(noteId, reasonHash)` → DISPUTED |
| GET | `/admin/disputes` | Admin: daftar dispute |
| POST | `/admin/disputes/:id/close` | `{ resolution, forwardRequest }` ditandatangani wallet `ADMIN_ROLE` → `closeDispute`; PAID + burn jika sudah lunas |
| POST | `/admin/notes/:id/freeze` | `{ reason, forwardRequest }` → `freeze` (piutang belum aktif: DB saja) |
| POST | `/admin/notes/:id/unfreeze` | `{ resolution, forwardRequest }` → `unfreeze`; hanya jika integrity VERIFIED |
| GET | `/admin/audit-logs?noteId=` | Audit log |
| GET | `/notifications` | Daftar notifikasi in-app |
| POST | `/notifications/:id/read` | Tandai sudah dibaca |

## Contoh

```http
POST /api/v1/notes
{
  "role": "creditor",
  "title": "Pinjaman renovasi warung",
  "debtType": "personal",
  "principal": "5000000",
  "interest": { "type": "none" },
  "lateFee": true,
  "repaymentScheme": "installment",
  "installments": [
    { "dueDate": "2026-11-30", "amount": "2500000" },
    { "dueDate": "2026-12-31", "amount": "2500000" }
  ],
  "disbursement": "onchain"
}
→ 201 { "id": "0192…", "status": "DRAFT", "version": 1 }
```

## Error

`{ "error": { "code": "NOTE_FROZEN", "message": "…" } }`
Kode umum: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `PHONE_NOT_VERIFIED` 403, `NOT_FOUND` 404, `INVALID_STATUS` 409, `DOC_HASH_EXISTS` 409, `SIGNATURE_INVALID` 422, `SIGNATURE_EXPIRED` 422, `NONCE_USED` 409, `FORWARD_REQUEST_INVALID` 422, `FILE_INVALID` 422, `NOTE_FROZEN` 423, `RATE_LIMITED` 429.

Header `Idempotency-Key` wajib untuk `/notes/:id/sign`, `/notes/:id/payments/*`, `/payments/:id/confirm`, dan `/notes/:id/confirm-disbursement`.
