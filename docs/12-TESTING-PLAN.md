# 12 — Testing Plan

## Level Pengujian

| Level | Tool | Target |
|-------|------|--------|
| Smart contract unit | Hardhat 3 + Mocha + Chai + ethers (`npx hardhat test`, `npx hardhat test --coverage`) | Coverage ≥ 90% |
| Static analysis | Slither | Tanpa high/medium |
| Backend unit & integration | Vitest + Supertest, Postgres test container | Service & endpoint utama |
| E2E | Playwright + Hardhat Network lokal | Flow utama end-to-end |
| Manual / demo | Checklist | Sebelum presentasi |

## Smart Contract

| ID | Skenario | Ekspektasi |
|----|----------|-----------|
| SC-01 | Mint dengan 2 signature valid | Token ke kreditur, `NoteMinted` |
| SC-02 | Mint dengan 1 signature / signature salah | Revert `InvalidSignature` |
| SC-03 | Mint dengan `docHash` yang sudah dipakai | Revert `DocHashUsed` |
| SC-04 | Signature lewat `deadline` | Revert `SignatureExpired` |
| SC-05 | Replay signature yang sama | Revert (nonce terpakai) |
| SC-06 | Escrow on-chain saat mint | Saldo debitur bertambah sebesar pokok |
| SC-07 | `repay` sebagian | `outstanding` berkurang |
| SC-08 | `repay` melebihi sisa | Revert `AmountExceedsOutstanding` |
| SC-09 | `repay` sampai nol | Token di-burn, status PAID |
| SC-09a | `mintNote` dengan jadwal tidak cocok `scheduleHash` / Σ ≠ pokok + bunga / `lateFeeBps` selain 0 atau 200 | Revert `ScheduleMismatch` / `InvalidTerms` |
| SC-10 | `transferFrom` token | Revert `NonTransferable` |
| SC-11 | `markOverdue` sebelum/sesudah jatuh tempo cicilan **pertama** | Revert `NotOverdue` / OVERDUE |
| SC-11a | OVERDUE lalu bayar tunggakan cicilan 1 (cicilan 2 belum jatuh tempo) | Status kembali ACTIVE |
| SC-11b | Cicilan Rp2.500.000 terlambat 15 hari, `lateFeeBps = 200` | Late fee = Rp25.000 (`outstanding()` bertambah) |
| SC-11c | Late fee saat DISPUTED/FROZEN | Tidak bertambah selama periode itu |
| SC-11d | Bayar saat ada late fee | Alokasi ke cicilan dulu, sisa ke late fee (`Repaid.toInstallments/toLateFee`) |
| SC-12 | `repay` saat FROZEN | Revert `NoteFrozen` |
| SC-13 | Freeze oleh non-guardian | Revert AccessControl |
| SC-14 | DISPUTED: repay sampai nol, lalu `setDisputed(false)` | Outstanding 0, burn ditunda; saat ditutup → PAID + `NoteBurned` |
| SC-15 | Loop 100x jumlah repay acak | Total bayar tidak pernah > pokok + bunga + late fee |
| SC-16 | `mintNote` sebelum deadline, lalu `time.increaseTo` lewat jatuh tempo (hardhat-network-helpers) | `markOverdue` berhasil |
| SC-17 | `confirmOffchainPayment` dengan signature yang sama dua kali | Revert (nonce terpakai) |
| SC-18 | Freeze saat DISPUTED lalu unfreeze | Status kembali DISPUTED |

## Backend

| ID | Skenario | Ekspektasi |
|----|----------|-----------|
| BE-01 | SIWE nonce dipakai dua kali | 401 |
| BE-02 | User non-pihak akses `/notes/:id` | 403 |
| BE-03 | Revisi draft | Versi baru, signature lama `is_valid=false` |
| BE-04 | Sign dengan HP belum terverifikasi | 403 |
| BE-05 | Upload file > 10 MB / tipe salah | 422 |
| BE-06 | Event `Repaid` diproses dua kali | Payment hanya tercatat sekali |
| BE-07 | Kreditur konfirmasi bayar off-chain | Payment CONFIRMED, alokasi ke cicilan tertua |
| BE-08 | Cron overdue | `markOverdue` dikirim; status DB OVERDUE hanya setelah event `StatusChanged` + notifikasi ke kedua pihak |
| BE-11 | Pencairan off-chain | Setelah 2 signature → AWAITING_DISBURSEMENT, belum ada mint; setelah `confirm-disbursement` → mint → ACTIVE |
| BE-12 | `confirm-disbursement` oleh kreditur / di status lain | 403 / 409 |
| BE-09 | Cron reminder | Notifikasi H-3 dan H-0 terkirim tepat sekali |
| BE-10 | Admin coba PATCH nominal | 403 |

## Integrity / Tamper Detection

| ID | Skenario | Ekspektasi |
|----|----------|-----------|
| IT-01 | Data tidak diubah | VERIFIED |
| IT-02 | Ubah `principal` langsung di DB | TAMPERED → FROZEN |
| IT-03 | Ganti file dokumen di storage | TAMPERED → FROZEN |
| IT-04 | Bayar saat FROZEN | Ditolak (API 423 + contract revert) |
| IT-05 | Admin unfreeze setelah data dipulihkan | VERIFIED, status kembali |

## E2E (Playwright)

1. Kreditur login embedded wallet → OTP → buat draft 2 cicilan → undang.
2. Debitur login → review → minta revisi → kreditur revisi → debitur tanda tangan.
3. Kreditur tanda tangan + escrow → token ter-mint → ACTIVE.
4. Debitur bayar cicilan 1 on-chain, cicilan 2 off-chain → kreditur konfirmasi → PAID.
5. Assert: tidak ada prompt gas, token di-burn, bukti lunas berisi txHash.

## Definition of Done

- Semua test hijau di CI.
- Coverage contract ≥ 90%.
- Skenario E2E utama lulus di Sepolia staging.
