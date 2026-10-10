# 02 — User Flow

Flow utama: **kreditur membuat piutang → pencairan on-chain → debitur bayar cicilan sampai lunas.**

## Flow Utama

```mermaid
flowchart TD
    subgraph K[Kreditur]
        K1[Login<br/>Wallet atau email/Google] --> K2[Verifikasi nomor HP<br/>OTP, cukup sekali]
        K2 --> K3[Buat draft piutang<br/>Nominal, tenor, cicilan, dokumen]
        K3 --> K4[Undang debitur<br/>Link atau alamat wallet]
        K5[Revisi draft<br/>Versi baru, kirim ulang] --> K4
        K6[Tanda tangan + setor dana<br/>Stablecoin masuk escrow]
    end

    subgraph D[Debitur]
        D1[Login] --> D2[Verifikasi nomor HP]
        D2 --> D3[Review draft<br/>Cek isi + dokumen]
        D3 --> D4{Setuju?}
        D4 -- minta revisi --> K5
        D4 -- tolak --> R[REJECTED]
        D4 -- setuju --> D5[Tanda tangan<br/>EIP-712, tanpa gas]
        D6[Terima pengingat<br/>H-3 dan H-0] --> D7[Bayar cicilan<br/>Stablecoin IDRX + fee aplikasi 1%]
    end

    K4 --> D3
    D5 --> M{Metode pencairan?}
    M -- on-chain --> K6
    K6 --> S1[[Sistem: mint token ke kreditur<br/>Escrow dilepas ke debitur, ACTIVE]]
    M -- off-chain --> K8[Tanda tangan<br/>Lalu transfer sendiri]
    K8 --> AW[AWAITING_DISBURSEMENT]
    AW --> D8[Konfirmasi terima dana]
    D8 --> S3[[Sistem: mint token ke kreditur<br/>ACTIVE]]
    S1 --> D6
    S3 --> D6
    D7 --> C{Sisa nol?}
    C -- belum --> D6
    C -- ya --> S2[[Sistem: PAID, token di-burn<br/>Bukti lunas + txHash ke kedua pihak]]
```

## Langkah per Tahap

| # | Tahap | Aktor | Status setelahnya |
|---|-------|-------|-------------------|
| 1 | Login + OTP | Keduanya | — |
| 2 | Buat draft | Kreditur | DRAFT |
| 3 | Undang pihak lawan | Kreditur | PENDING_SIGNATURE |
| 4 | Review: setuju / revisi / tolak | Debitur | PENDING_SIGNATURE / DRAFT (versi baru) / REJECTED |
| 5 | Tanda tangan debitur | Debitur | PENDING_SIGNATURE |
| 6 | Tanda tangan + setor escrow | Kreditur | PENDING_SIGNATURE |
| 7 | Mint token + lepas escrow | Sistem | ACTIVE |
| 8 | Pengingat H-3 & H-0 | Sistem | ACTIVE |
| 9 | Bayar cicilan (+ late fee jika terlambat) | Debitur | ACTIVE / OVERDUE |
| 10 | Sisa nol → burn | Sistem | PAID |

## Variasi

- **Debitur membuat draft** (pengajuan utang): kedua lane tinggal ditukar sampai tahap tanda tangan.
- **Pencairan off-chain:** setelah dua tanda tangan (tanpa escrow) status AWAITING_DISBURSEMENT; kreditur mentransfer sendiri, debitur konfirmasi terima dana, lalu token di-mint dan status ACTIVE.
- **Terlambat bayar:** cicilan lewat jatuh tempo → OVERDUE + late fee 2%/bulan (jika disepakati); setelah tunggakan dan late fee dibayar kembali ACTIVE.
- **Dispute:** dari ACTIVE atau OVERDUE, salah satu pihak bisa mengajukan → DISPUTED.
- **Integrity gagal** di tahap mana pun → TAMPERED → FROZEN.
- **Cancel:** pembuat bisa membatalkan selama belum dua signature → CANCELLED. Kreditur juga bisa membatalkan selama AWAITING_DISBURSEMENT.
