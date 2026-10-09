# 13 — Demo Flow

Durasi target: **5–7 menit**. Dua browser: kiri **Kreditur (Andi)**, kanan **Debitur (Budi)**.

## Persiapan

- [ ] Dua akun sudah login & OTP terverifikasi.
- [ ] Wallet Andi punya MockIDRX dari faucet (min. Rp10.000.000).
- [ ] Saldo relayer Sepolia ETH cukup.
- [ ] Tab Sepolia Etherscan siap.
- [ ] Satu piutang cadangan sudah ACTIVE (jaga-jaga jika jaringan lambat).

## Skrip

| # | Menit | Aksi | Poin yang disampaikan |
|---|-------|------|-----------------------|
| 1 | 0:00 | Buka masalah: utang ke teman tanpa bukti, bukti mudah diubah | Hook |
| 2 | 0:45 | Andi login dengan **Google** → langsung punya wallet | Tanpa paham crypto |
| 3 | 1:15 | Andi buat draft Rp5.000.000, 2 cicilan, upload kuitansi | Jadwal bayar jelas |
| 4 | 2:00 | Andi kirim link undangan → Budi buka | — |
| 5 | 2:20 | Budi minta revisi tanggal → Andi revisi → versi 2 | Signature lama batal |
| 6 | 3:00 | Budi tanda tangan, lalu Andi tanda tangan + setor escrow | **Tanpa gas** |
| 7 | 3:40 | Token ter-mint, dana masuk ke Budi, status ACTIVE; buka Etherscan | Bukti on-chain |
| 8 | 4:20 | Budi bayar cicilan 1 dengan stablecoin → sisa berkurang otomatis | On-chain langsung tercatat |
| 9 | 4:50 | Budi upload bukti transfer cicilan 2 → Andi konfirmasi → **PAID**, token di-burn | Off-chain juga didukung |
| 10 | 5:30 | **Tamper demo:** ubah nominal piutang cadangan di DB → klik "Cek Integritas" → **TAMPERED → FROZEN** | Data tidak bisa diubah diam-diam |
| 11 | 6:15 | Penutup: roadmap (cessie, e-KYC, mainnet) | — |

## Rencana Cadangan

- Sepolia lambat → pakai piutang cadangan yang sudah ACTIVE.
- OTP gagal → akun sudah pre-verified.
- Internet mati → video rekaman demo.
