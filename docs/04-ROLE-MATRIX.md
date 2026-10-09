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
| Set OVERDUE / kembali ACTIVE | ❌ | ❌ | ❌ | ⚙️ dihitung contract saat dibaca (`statusOf`) | ❌ |
| Hitung late fee | ❌ | ❌ | ❌ | ⚙️ (contract) | ❌ |
| Burn token (PAID) | ❌ | ❌ | ❌ | ⚙️ | ❌ |
| Mengajukan dispute | ✅ (`openDispute`) | ✅ (`openDispute`) | ❌ | ❌ | ❌ |
| Menutup dispute | ❌ | ❌ | ✅ (`closeDispute`, burn jika sisa nol) | ❌ | ❌ |
| Integrity check | ✅ (trigger) | ✅ (trigger) | ✅ | ⚙️ terjadwal | ❌ |
| Freeze piutang | ❌ | ❌ | ✅ | ⚙️ saat TAMPERED | ❌ |
| Unfreeze piutang | ❌ | ❌ | ✅ | ❌ | ❌ |
| Mengikhlaskan sisa utang (`markPaid`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Menarik escrow sebelum aktif (`refundEscrow`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ubah nominal/isi perjanjian | via revisi ulang (`amend`) | via revisi ulang (`amend`) | ❌ | ❌ | ❌ |
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

| Role | Pemegang | Fungsi |
|------|----------|--------|
| `DEFAULT_ADMIN_ROLE` | Multisig tim (default: deployer) | Grant/revoke role |
| `ADMIN_ROLE` | Wallet admin platform | `closeDispute`, `freeze`, `unfreeze`, `pause`, `unpause` |
| `FREEZER_ROLE` | Wallet integrity checker | Hanya `freeze` |

Tidak ada role relayer: aktivasi, setor escrow, konfirmasi off-chain, dan revisi diotorisasi oleh signature para pihak, jadi relayer mana pun boleh mengirimnya. Aksi pengguna (bayar, `openDispute`, `markPaid`, `refundEscrow`, `cancelNonce`) dicek dari `_msgSender()`, langsung atau lewat `PiutangForwarder`. OVERDUE dihitung contract saat dibaca, tanpa tx. Freeze piutang yang belum aktif hanya terjadi di DB.
