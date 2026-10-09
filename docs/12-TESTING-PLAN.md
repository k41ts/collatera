# 12 — Testing Plan

## Level Pengujian

| Level | Tool | Target |
|-------|------|--------|
| Smart contract unit | Hardhat 2 + Mocha + Chai + ethers (`npm test`, `npm run coverage` di `piutangchain-contracts/`) | Semua lulus, coverage ≥ 90% |
| Static analysis | Slither | Tanpa high/medium |
| Backend unit & integration | Vitest + Supertest, Postgres test container | Service & endpoint utama |
| E2E | Playwright + Hardhat Network lokal | Flow utama end-to-end |
| Manual / demo | Checklist | Sebelum presentasi |

## Smart Contract

Test ada di `piutangchain-contracts/test/` (81 test, semua lulus per 9 Okt 2026). Helper bersama di `fixture.js`.

| File | Yang dicakup |
|------|--------------|
| `00-primitives.test.js` | Hash EIP-712 contract = hash ethers (`helpers/eip712.js`); MockIDRX (ERC-20, permit, tolak signature malleable, faucet cooldown); DebtNote non-transferable (`Soulbound`) dan `tokenURI`; PiutangForwarder (pemanggil asli, replay, revert diteruskan, anti-spoof) |
| `10-lifecycle.test.js` | Alur penuh: escrow → aktivasi on-chain → bayar → PAID + burn; pencairan off-chain dengan receipt; pembayaran campuran; `markPaid`; OVERDUE dan denda; gasless lewat forwarder |
| `20-security.test.js` | Satu docHash = satu token, replay nonce, signature salah/kedaluwarsa/domain lain, validasi field, escrow (refund, deposit ganda), batas pembayaran, smart account (ERC-1271), pause dan role |
| `30-dispute-freeze-amend.test.js` | Dispute (buka/tutup, lunas saat dispute), freeze/unfreeze (termasuk dari DISPUTED), integrity check end-to-end, revisi `amend`, aksi pengguna lewat forwarder |
| `40-hostile-token.test.js` | Token tanpa return value, token yang return false, fee-on-transfer ditolak, re-entrancy diblok |
| `50-late-fee-schedule.test.js` | Jadwal on-chain, OVERDUE per cicilan, denda 2%/30 hari per segmen, alokasi tunggakan → denda → cicilan berikutnya, denda berhenti saat DISPUTED/FROZEN, validasi jadwal (maks 24), cek gas forwarder |
| `60-regressions.test.js` | `refundEscrow` membatalkan signature kreditur; denda tidak bisa dihapus dengan `accrue()` tiap blok (`feeRemainder`) |

Skenario wajib yang harus tetap ada di suite:

| ID | Skenario | Ekspektasi |
|----|----------|-----------|
| SC-01 | Aktivasi dengan 2 signature valid | DebtNote ter-mint ke kreditur, `NoteActivated`, status ACTIVE |
| SC-02 | Satu signature salah / milik akun lain | Revert `InvalidSignature` |
| SC-03 | `docHash` yang sudah dipakai (termasuk hash lama hasil revisi) | Revert `DocHashAlreadyUsed` |
| SC-04 | Signature lewat `deadline` | Revert `SignatureExpired` |
| SC-05 | Nonce dipakai ulang / dibatalkan `cancelNonce` | Revert `NonceAlreadyUsed` |
| SC-06 | Aktivasi on-chain tanpa escrow | Revert `EscrowMissing` |
| SC-07 | Refund lalu setor ulang dengan signature lama | Revert `NonceAlreadyUsed` |
| SC-08 | Bayar on-chain melebihi sisa | Yang ditarik hanya sisa utang; off-chain → revert `Overpayment` |
| SC-09 | Bayar sampai nol | PAID + burn di tx yang sama |
| SC-10 | `transferFrom` / `approve` DebtNote | Revert `Soulbound` |
| SC-11 | Cicilan pertama lewat jatuh tempo | `statusOf` = OVERDUE; bayar tunggakan + denda → ACTIVE lagi |
| SC-12 | Cicilan Rp400.000 terlambat 15 hari | Denda Rp4.000 |
| SC-13 | Denda saat DISPUTED/FROZEN | Tidak bertambah |
| SC-14 | Lunas saat DISPUTED | Burn ditahan; `closeDispute` → PAID + burn |
| SC-15 | Bayar, konfirmasi off-chain, revisi saat FROZEN | Revert `InvalidStatus` |
| SC-16 | `freeze` oleh akun tanpa role / `unfreeze` oleh FREEZER | Revert `AccessControlUnauthorizedAccount` |
| SC-17 | Jadwal tidak cocok `scheduleHash` / Σ ≠ total / > 24 cicilan | Revert `ScheduleMismatch` / `InvalidSchedule` |
| SC-18 | `accrue()` dipanggil tiap blok | Denda sama dengan tanpa `accrue` |

## Backend

| ID | Skenario | Ekspektasi |
|----|----------|-----------|
| BE-01 | SIWE nonce dipakai dua kali | 401 |
| BE-02 | User non-pihak akses `/notes/:id` | 403 |
| BE-03 | Revisi draft | Versi baru, signature lama `is_valid=false` |
| BE-04 | Sign dengan HP belum terverifikasi | 403 |
| BE-05 | Upload file > 10 MB / tipe salah | 422 |
| BE-06 | Event `PaymentRecorded` diproses dua kali | Payment hanya tercatat sekali (`txHash + logIndex`) |
| BE-07 | Kreditur konfirmasi bayar off-chain | Payment CONFIRMED, alokasi ke cicilan tertua |
| BE-08 | Cron overdue | Membaca `statusOf()`; status DB berubah ke OVERDUE (tanpa tx) + notifikasi ke kedua pihak tepat sekali |
| BE-09 | Cron reminder | Notifikasi H-3 dan H-0 terkirim tepat sekali |
| BE-10 | Admin coba PATCH nominal | 403 |
| BE-11 | Pencairan off-chain | Setelah 2 signature → AWAITING_DISBURSEMENT, belum ada mint; setelah debitur menandatangani receipt → `activateOffchain` → ACTIVE |
| BE-12 | `confirm-disbursement` oleh kreditur / di status lain | 403 / 409 |
| BE-13 | `payments/onchain` dengan `forwardRequest.data` untuk piutang/nominal lain | 422 `FORWARD_REQUEST_INVALID` |
| BE-14 | TAMPERED saat PENDING_SIGNATURE | FROZEN di DB saja, job aktivasi dibatalkan, tidak ada tx `freeze` |
| BE-15 | Draft on-chain dibatalkan/ditolak/direvisi setelah kreditur setor escrow | `refundEscrow` dikirim, dana kembali, signature lama tidak bisa dipakai |

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
