# 08 — API Specification

Base URL: `/api/v1` · Format: JSON · Auth: cookie `session` (JWT httpOnly) hasil SIWE.
Semua endpoint `/notes/:id/*` hanya untuk kreditur/debitur piutang itu (atau admin).

## Auth

| Method | Path | Body | Keterangan |
|--------|------|------|------------|
| GET | `/auth/nonce` | — | Nonce SIWE, berlaku 5 menit |
| POST | `/auth/verify` | `{ message, signature }` | Verifikasi SIWE, set session |
| POST | `/auth/logout` | — | Hapus session |
| POST | `/auth/otp/send` | `{ phone }` | Kirim OTP |
| POST | `/auth/otp/verify` | `{ phone, code }` | Tandai HP terverifikasi |
| GET | `/me` | — | Profil + status verifikasi |

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
| POST | `/notes/:id/sign` | `{ signature, permit? }` → simpan signature; jika lengkap, enqueue mint |
| POST | `/notes/:id/confirm-disbursement` | Debitur konfirmasi terima dana (off-chain) |

## Pembayaran

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/notes/:id/repay/typed-data` | Payload permit untuk bayar on-chain |
| POST | `/notes/:id/payments/onchain` | `{ amount, permitSig }` → enqueue repay |
| POST | `/notes/:id/payments/offchain` | Multipart `{ amount, proof }` → PENDING |
| POST | `/payments/:id/confirm` | Kreditur `{ signature }` → CONFIRMED |
| POST | `/payments/:id/reject` | Kreditur `{ reason }` → REJECTED |

## Integrity, Dispute, Admin

| Method | Path | Keterangan |
|--------|------|------------|
| POST | `/notes/:id/integrity-check` | Hitung ulang → `VERIFIED|TAMPERED` |
| POST | `/notes/:id/disputes` | `{ reason, evidence[] }` → DISPUTED |
| GET | `/admin/disputes` | Admin: daftar dispute |
| POST | `/admin/disputes/:id/close` | `{ resolution }` → status semula |
| POST | `/admin/notes/:id/freeze` | `{ reason }` |
| POST | `/admin/notes/:id/unfreeze` | Hanya jika integrity VERIFIED |
| GET | `/admin/audit-logs?noteId=` | Audit log |
| GET | `/notifications` · POST `/notifications/:id/read` | In-app |

## Contoh

```http
POST /api/v1/notes
{
  "role": "creditor",
  "title": "Pinjaman renovasi warung",
  "debtType": "personal",
  "principal": "5000000",
  "interest": { "type": "none" },
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
Kode umum: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `INVALID_STATUS` 409, `DOC_HASH_EXISTS` 409, `SIGNATURE_INVALID` 422, `SIGNATURE_EXPIRED` 422, `NOTE_FROZEN` 423, `RATE_LIMITED` 429.

Header `Idempotency-Key` wajib untuk `/sign`, `/payments/*`, dan `/confirm`.
