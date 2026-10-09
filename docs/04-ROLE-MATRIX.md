# 04 — Role Matrix

Peran ditentukan **per surat piutang**. Satu akun bisa jadi kreditur di satu piutang dan debitur di piutang lain.

## Definisi Role

| Role | Siapa | Catatan |
|------|-------|---------|
| **Kreditur** | Individu/perusahaan yang meminjamkan atau punya tagihan | Pemegang token |
| **Debitur** | Individu/perusahaan yang berutang | Pihak yang membayar |
| **Admin** | Tim operasional internal | Tidak bisa mengubah isi perjanjian |
| **Sistem** | Backend, relayer, cron, integrity checker | Aktor otomatis |
| **Non-pihak** | User login yang bukan kreditur/debitur piutang tsb | Tidak punya akses |

## Matriks Aksi

✅ = boleh · ❌ = tidak boleh · ⚙️ = otomatis oleh sistem

| Aksi | Kreditur | Debitur | Admin | Sistem | Non-pihak |
|------|:-:|:-:|:-:|:-:|:-:|
| Membuat draft | ✅ | ✅ (pengajuan) | ❌ | ❌ | — |
| Melihat detail piutang | ✅ | ✅ | ✅ (saat dispute/freeze) | ✅ | ❌ |
| Mengundang pihak lawan | ✅ pembuat | ✅ pembuat | ❌ | ❌ | ❌ |
| Merevisi draft | ✅ | ✅ | ❌ | ❌ | ❌ |
| Menolak draft | ✅ pihak lawan | ✅ pihak lawan | ❌ | ❌ | ❌ |
| Membatalkan draft | ✅ pembuat | ✅ pembuat | ❌ | ❌ | ❌ |
| Tanda tangan EIP-712 | ✅ | ✅ | ❌ | ❌ | ❌ |
| Setor dana escrow | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mint token | ❌ | ❌ | ❌ | ⚙️ | ❌ |
| Konfirmasi terima dana (off-chain) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Bayar cicilan | ❌ | ✅ | ❌ | ❌ | ❌ |
| Upload bukti transfer | ❌ | ✅ | ❌ | ❌ | ❌ |
| Konfirmasi / tolak bayar off-chain | ✅ | ❌ | ❌ | ❌ | ❌ |
| Set OVERDUE / kembali ACTIVE | ❌ | ❌ | ❌ | ⚙️ (`markOverdue` / otomatis saat bayar) | ❌ |
| Hitung late fee | ❌ | ❌ | ❌ | ⚙️ (contract) | ❌ |
| Burn token (PAID) | ❌ | ❌ | ❌ | ⚙️ | ❌ |
| Mengajukan dispute | ✅ | ✅ | ❌ | ❌ | ❌ |
| Menutup dispute | ❌ | ❌ | ✅ | ⚙️ kirim tx `setDisputed(false)`, burn jika sisa nol | ❌ |
| Integrity check | ✅ (trigger) | ✅ (trigger) | ✅ | ⚙️ terjadwal | ❌ |
| Freeze piutang | ❌ | ❌ | ✅ | ⚙️ saat TAMPERED | ❌ |
| Unfreeze piutang | ❌ | ❌ | ✅ | ❌ | ❌ |
| Ubah nominal/isi perjanjian | via revisi ulang | via revisi ulang | ❌ | ❌ | ❌ |
| Lihat audit log | ✅ (piutang sendiri) | ✅ (piutang sendiri) | ✅ (semua) | — | ❌ |

## Batasan Berdasarkan Status

| Status | Aksi yang masih terbuka |
|--------|-------------------------|
| DRAFT | edit, undang, cancel |
| PENDING_SIGNATURE | tanda tangan, revisi, tolak, cancel, setor escrow |
| AWAITING_DISBURSEMENT | debitur konfirmasi terima dana, kreditur cancel |
| ACTIVE / OVERDUE | bayar, konfirmasi bayar, dispute, integrity check |
| DISPUTED | bayar on-chain saja; burn & konfirmasi off-chain ditahan |
| FROZEN | baca saja; admin bisa unfreeze |
| PAID / REJECTED / CANCELLED | baca saja (final) |

## Role di Smart Contract

| Role (OpenZeppelin AccessControl) | Pemegang | Fungsi |
|-----------------------------------|----------|--------|
| `DEFAULT_ADMIN_ROLE` | Multisig tim | Atur role |
| `RELAYER_ROLE` | Wallet relayer | `mintNote`, `confirmOffchainPayment` |
| `GUARDIAN_ROLE` | Admin + integrity service | `freeze`, `unfreeze`, `setDisputed` |
| `MINTER_ROLE` (MockIDR) | Wallet relayer | `faucet` (testnet) |

`repay` tidak butuh role: dipanggil debitur lewat `Forwarder` (ERC-2771). `markOverdue` dan `accrue` boleh dipanggil siapa saja; dalam praktik cron worker mengantrekannya ke relayer worker dan tx dikirim dengan wallet relayer. Freeze piutang yang belum di-mint hanya terjadi di DB.
