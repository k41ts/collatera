# 08 — API Specification

Base URL: `/api/v1` · Format: JSON · Auth: cookie `session` (JWT httpOnly) hasil SIWE.
Semua endpoint `/notes/:id/*` hanya untuk kreditur/debitur piutang itu (atau admin saat piutang DISPUTED/FROZEN, lihat [04-ROLE-MATRIX](04-ROLE-MATRIX.md)).
Nominal dikirim sebagai string rupiah utuh (mis. `"5000000"`); backend mengonversi ke 18 desimal (`× 10^18`) sebelum disimpan dan dikirim ke contract.

## Auth

| Method | Path | Body | Keterangan |
|--------|------|------|------------|
| GET | `/auth/nonce` | — | Nonce SIWE, berlaku 5 menit |
| POST | `/auth/verify` | `{ message, signature }` | Verifikasi SIWE, set session |
| POST | `/auth/logout` | — | Hapus session |
| POST | `/auth/otp/send` | `{ phone }` | Kirim OTP |
| POST | `/auth/otp/verify` | `{ phone, code }` | Tandai HP terverifikasi |
| GET | `/me` | — | Profil + status verifikasi |
| POST | `/faucet` | — | Testnet saja: relayer mengirim MockIDR ke wallet user (gasless), dibatasi rate limit |

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
| GET | `/notes/:id/typed-data` | Payload EIP-712 untuk ditandatangani |
| POST | `/notes/:id/sign` | `{ signature, permit? }` → simpan signature; jika lengkap: on-chain → enqueue mint, off-chain → AWAITING_DISBURSEMENT |
| POST | `/notes/:id/confirm-disbursement` | Debitur konfirmasi terima dana (hanya AWAITING_DISBURSEMENT) → enqueue mint → ACTIVE |

## Pembayaran

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/notes/:id/outstanding` | Sisa cicilan, late fee berjalan, total (dibaca dari contract `outstanding()`) |
| GET | `/notes/:id/repay/typed-data?amount=` | Typed data permit MockIDR + domain & `nonce` Forwarder + `deadline` (lihat [11-BLOCKCHAIN-SPEC](11-BLOCKCHAIN-SPEC.md#bayar-on-chain-lewat-forwarder)) |
| POST | `/notes/:id/payments/onchain` | `{ amount, permit: { deadline, v, r, s }, forwardRequest: { from, to, value, gas, deadline, data, signature } }` → backend cek `data` = `repay(tokenId, amount, permit)` → enqueue `Forwarder.execute` |
| POST | `/notes/:id/payments/offchain` | Multipart `{ amount, proof }` → PENDING |
| GET | `/payments/:id/typed-data` | Payload EIP-712 `OffchainPayment` untuk konfirmasi kreditur |
| POST | `/payments/:id/confirm` | Kreditur `{ signature }` → CONFIRMED |
| POST | `/payments/:id/reject` | Kreditur `{ reason }` → REJECTED |

## Integrity, Dispute, Admin

| Method | Path | Keterangan |
|--------|------|------------|
| POST | `/notes/:id/integrity-check` | Hitung ulang → `VERIFIED|TAMPERED` |
| POST | `/notes/:id/disputes` | `{ reason, evidence[] }` → DISPUTED |
| GET | `/admin/disputes` | Admin: daftar dispute |
| POST | `/admin/disputes/:id/close` | `{ resolution }` → enqueue `setDisputed(false)`; status dihitung ulang (PAID + burn jika sisa nol) |
| POST | `/admin/notes/:id/freeze` | `{ reason }` |
| POST | `/admin/notes/:id/unfreeze` | Hanya jika integrity VERIFIED |
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
