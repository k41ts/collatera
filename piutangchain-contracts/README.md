# PiutangChain — Smart Contracts

Hardhat 2 (JavaScript), Solidity 0.8.28, **tanpa OpenZeppelin**: ECDSA, EIP-712, AccessControl, Pausable,
ReentrancyGuard, ERC-721, ERC-2612, ERC-2771, dan ERC-1271 ditulis sendiri di `contracts/utils` dan `contracts/libraries`.

> **Belum diaudit.** Primitif kripto tulisan sendiri adalah risiko terbesar proyek ini. Cocok untuk Sepolia/prototipe.
> Sebelum dana nyata, ganti ke library teraudit atau minta audit.

## Perintah

```bash
npm install
npm test                 # 82 test
npm run coverage         # solidity-coverage
npm run size             # ukuran bytecode vs batas 24 KB
npm run deploy:local
cp .env.example .env     # isi RPC + key, lalu:
npm run deploy:sepolia   # tulis deployments/sepolia.json
```

Jika binary compiler tidak bisa diunduh (jaringan terbatas): `npm i --no-save solc@0.8.28` lalu jalankan dengan `SOLCJS=1`.

## Kontrak

| Kontrak | Fungsi |
|---|---|
| `DebtManager` | Inti: verifikasi 2 signature EIP-712, mint, pencairan, pembayaran, OVERDUE, PAID+burn, dispute, freeze, revisi |
| `DebtNote` | ERC-721 non-transferable (juga ERC-5192). `tokenId = uint256(noteId)`. `tokenURI` memuat metadata on-chain |
| `MockIDRX` | Stablecoin IDR tiruan (testnet): ERC-20 + permit + faucet. Default 2 desimal |
| `PiutangForwarder` | Forwarder ERC-2771 untuk gasless (relayer bayar gas) |

## Status

On-chain: `ACTIVE → PAID`, `ACTIVE ↔ DISPUTED`, `ACTIVE|DISPUTED ↔ FROZEN`. `OVERDUE` **dihitung** saat dibaca
**per cicilan**: ada cicilan yang jatuh temponya sudah lewat dan belum dibayar, atau denda belum dibayar. Tidak butuh keeper. `DRAFT / PENDING_SIGNATURE / REJECTED / CANCELLED`
hanya ada di backend: piutang baru lahir on-chain saat aktivasi.

## Alur → fungsi

| PRD | Fungsi |
|---|---|
| Kreditur tanda tangan + setor dana (on-chain) | `depositEscrow(note, sigKreditur, permit)` |
| Debitur tanda tangan → mint, dana lepas, ACTIVE | `activateOnchain(note, schedule, sigKreditur, sigDebitur)` |
| Pencairan off-chain: debitur konfirmasi terima dana | `activateOffchain(note, schedule, sigK, sigD, receipt, sigReceipt)` |
| Tarik dana escrow sebelum aktif (signature kreditur ikut batal) | `refundEscrow(note)` |
| Bayar on-chain (`amount` = batas maksimal, yang ditarik hanya sisa utang) | `payOnchain(noteId, amount, installmentIndex, permit)` |
| Bayar off-chain, dikonfirmasi kreditur | `recordOffchainPayment(confirmation, sigKreditur)` |
| Kreditur menandai lunas | `markPaid(noteId)` |
| Revisi setelah ACTIVE (2 signature) | `amend(amendment, schedule, sigK, sigD)` |
| Dispute / tutup dispute (admin) | `openDispute` / `closeDispute` |
| Integrity: hash cocok? / auto-freeze / buka | `verifyHash` / `freeze` / `unfreeze` |
| Batalkan signature | `cancelNonce(nonce)` |
| Simpan denda berjalan (opsional, semua fungsi tulis sudah melakukannya) | `accrue(noteId)` |
| Baca | `getNote`, `getSchedule`, `statusOf`, `remaining`, `overdueAmount`, `lateFeeOf`, `requiredAmount`, `noteHash` |

Semua event penting memakai `noteId` ter-index; **semua perubahan status** memancarkan `StatusChanged`
(untuk audit log dan idempotency indexer: kunci `txHash + logIndex`).

## Role

- `DEFAULT_ADMIN_ROLE`: kelola role. **Pakai multisig di produksi.**
- `ADMIN_ROLE`: tutup dispute, buka freeze, freeze, pause.
- `FREEZER_ROLE`: hanya `freeze` (untuk key integrity checker; kalau bocor, paling buruk piutang dibekukan lalu dibuka admin).
- Tidak ada fungsi untuk mengubah isi perjanjian atau memindahkan dana oleh admin.

## EIP-712

Domain DebtManager: `{ name: "PiutangChain", version: "1", chainId, verifyingContract }`.
Struct: `Note`, `DisbursementReceipt`, `PaymentConfirmation`, `Amendment`. Forwarder: `ForwardRequest`.
Backend/frontend **harus memakai `helpers/eip712.js`** (urutan dan tipe field menentukan hash; test memastikan hash kontrak = hash ethers).

`Note.docHash` = keccak256 dari canonical payload + hash dokumen pendukung.
`scheduleHash = keccak256(abi.encode(uint64[] dueDates, uint256[] amounts))` (helper: `scheduleHash()` di `helpers/eip712.js`).
Jadwal lengkap (`Schedule`) dikirim saat aktivasi/revisi dan dicocokkan dengan hash itu: maks 24 cicilan, tanggal urut naik,
nominal > 0, jumlah = `totalOwed`, tanggal terakhir = `dueDate`; saat aktivasi cicilan pertama harus di masa depan.
Nominal memakai satuan terkecil token (`decimals`, default 2). Samakan di database dan UI.

## Keputusan desain (hal yang PRD tidak tentukan)

1. **Bunga/fee**: `totalOwed` (pokok + bunga) dihitung off-chain dan ikut ditandatangani; kontrak tidak menghitung bunga. `principal ≤ totalOwed`.
2. **Denda (BR-21a)**: `lateFeeBps` hanya `0` (tidak disepakati) atau `200` = **2% per 30 hari** dari cicilan yang terlambat,
   pro-rata per detik, tidak majemuk. Dihitung per segmen jatuh tempo sehingga hasilnya tepat walau tidak ada yang memanggil
   `accrue`. Denda **berhenti** selama DISPUTED dan FROZEN. Denda yang sudah berjalan tetap terutang setelah revisi.
   Contoh: cicilan Rp400.000 terlambat 15 hari → Rp4.000.
3. **Jadwal cicilan** disimpan on-chain. Alokasi pembayaran (BR-19): tunggakan cicilan (tertua dulu) → denda → cicilan berikutnya.
   `OVERDUE` bertahan sampai tunggakan **dan** denda lunas. `installmentIndex` di pembayaran hanya informasi (event).
4. **Pencairan off-chain**: token baru di-mint setelah debitur menandatangani receipt (dalam satu transaksi), sehingga tidak ada token untuk utang yang uangnya belum cair.
5. **DISPUTED**: pembayaran on-chain tetap masuk; burn ditahan sampai `closeDispute`; konfirmasi off-chain dan `markPaid` ditolak. `amend` tetap boleh (jalan keluar sengketa sesuai PRD).
6. **FROZEN** menolak pembayaran, revisi, dispute baru, markPaid, dan burn. Hanya `ACTIVE`/`DISPUTED` yang bisa dibekukan: piutang `PAID` sudah final.
7. **Kelebihan bayar**: on-chain dipotong ke sisa utang (denda bertambah per detik, jadi nominal "lunas" tidak bisa ditebak
   tepat; frontend cukup mengirim sisa utang + sedikit buffer dan permit sebesar itu). Konfirmasi off-chain yang melebihi sisa ditolak.
8. **Pause** hanya menahan deposit, aktivasi, pembayaran, revisi, markPaid. Refund escrow, dispute, freeze tetap terbuka.
9. Hash dokumen terkunci seumur hidup (termasuk hash lama setelah revisi dan setelah burn).
10. **Batas nominal**: `totalOwed` maksimal `MAX_AMOUNT` (= `type(uint128).max`), agar perhitungan denda tidak overflow
    dan membuat freeze, dispute, atau pembayaran selalu revert.

## Keterbatasan yang perlu kamu tahu

- Jika kreditur menolak menandatangani konfirmasi padahal debitur sudah transfer, kontrak tidak bisa memaksa pencatatan (sesuai PRD: admin tidak boleh mengubah isi). Jalurnya dispute lalu revisi bertanda tangan.
- Permit stablecoin hanya untuk EOA. Smart account membayar dengan `approve` lebih dulu lalu `permit.deadline = 0`. Tanda tangan perjanjian mendukung EOA dan smart account (ERC-1271).
- Denda tetap berjalan saat kontrak di-`pause` walau pembayaran ditahan. Pause hanya untuk darurat singkat.
- Forwarder menolak eksekusi jika relayer memberi gas kurang dari `req.gas` (cek EIP-150), agar inner call seperti permit
  di dalam `try/catch` tidak bisa sengaja dibuat gagal.
- ERC-4337/paymaster tidak diimplementasikan; gasless memakai forwarder ERC-2771. Kontrak tidak upgradeable.
- Satu key `ADMIN_ROLE` bisa membekukan piutang mana pun. Itu titik kepercayaan; pakai multisig.
