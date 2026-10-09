# 01 — Product Requirements Document (PRD)

**Produk:** PiutangChain
**Sumber:** PiutangChain — Product Requirements Document (Oct 9, 2026, @Ezra)
**Status dokumen:** Draft hackathon / MVP

## 1. Ringkasan

PiutangChain adalah platform web3 untuk membuat, menandatangani, dan menagih **surat piutang (promissory note)** antara **kreditur** dan **debitur**. Bisa dipakai untuk pinjaman ke teman atau keluarga, invoice antar perusahaan, dan utang usaha lainnya.

Surat piutang yang sudah ditandatangani kedua pihak di-mint sebagai **token ERC-721** ke wallet kreditur. Token ini mewakili hak tagih. Dokumen dan data pribadi tetap **off-chain**. Yang masuk ke blockchain hanya hash dokumen, metadata piutang, dan bukti tanda tangan.

## 2. Masalah

- Utang informal (teman, keluarga, UMKM) sering tanpa bukti tertulis yang jelas.
- Bukti yang ada mudah diubah sepihak setelah disepakati.
- Pelacakan cicilan dan pengingat jatuh tempo masih manual.

## 3. Goals

1. Siapa pun bisa membuat surat piutang yang jelas: nominal, jatuh tempo, dan jadwal bayar.
2. Piutang baru aktif setelah **kedua pihak** menandatangani dengan wallet masing-masing.
3. Surat piutang menjadi token yang membuktikan kepemilikan hak tagih kreditur.
4. Setiap pembayaran tercatat, baik on-chain (stablecoin) maupun off-chain (bank atau tunai).
5. Debitur diingatkan sebelum dan saat jatuh tempo.
6. Perubahan data setelah penandatanganan terdeteksi, lalu piutang dibekukan.
7. Pengguna awam bisa memakai platform tanpa paham crypto.

## 4. Scope

**In scope:** SIWE, embedded wallet (email/Google), OTP HP, draft & negosiasi, tanda tangan EIP-712 gasless, upload dokumen, hashing Keccak-256, mint ERC-721, pencairan escrow/off-chain, cicilan, pembayaran stablecoin IDR (mock di testnet), pembayaran off-chain + konfirmasi, OVERDUE otomatis, late fee 2%/bulan, notifikasi email + in-app, pelunasan + burn, integrity checker, auto-freeze, dispute, relayer/paymaster, Sepolia, audit log.

**Out of scope:** pasar sekunder token, pendanaan investor/liquidity pool, credit scoring, e-KYC Dukcapil, debt collector, dokumen on-chain, on/off-ramp fiat, e-Meterai/TTE tersertifikasi, mainnet.

## 5. Success Criteria

- [ ] Piutang ACTIVE hanya setelah dua signature lengkap.
- [ ] Token ter-mint ke kreditur dan hash-nya sama dengan database.
- [ ] Satu hash dokumen tidak bisa menjadi dua token.
- [ ] Pembayaran on-chain langsung mengurangi sisa utang.
- [ ] Pembayaran off-chain tercatat hanya setelah kreditur konfirmasi.
- [ ] Cicilan lewat jatuh tempo & belum lunas → OVERDUE otomatis (per cicilan, sama di DB dan on-chain).
- [ ] Late fee 2% per bulan dihitung otomatis jika disepakati.
- [ ] Lunas penuh → PAID dan token di-burn.
- [ ] Hash bisa diverifikasi ulang kapan saja; mismatch → TAMPERED → FROZEN.
- [ ] Piutang FROZEN menolak pembayaran, perubahan, dan burn.
- [ ] Pengguna embedded wallet menyelesaikan seluruh alur tanpa membeli gas.

## 6. Pertanyaan Terbuka

- Bunga/fee diizinkan di MVP atau hanya pinjaman tanpa bunga?
- Token perlu bisa dialihkan (cessie) di versi berikutnya?
- Siapa menanggung biaya gas relayer jangka panjang?

Detail lanjutan: alur di [02-USER-FLOW](02-USER-FLOW.md), aturan di [03-BUSINESS-RULES](03-BUSINESS-RULES.md).
