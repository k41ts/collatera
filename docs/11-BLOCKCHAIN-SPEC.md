# 11 — Blockchain Specification

Chain: **Ethereum Sepolia** (`chainId 11155111`) · Solidity `0.8.28` · Hardhat 2 · **tanpa OpenZeppelin** (ECDSA, EIP-712, AccessControl, Pausable, ReentrancyGuard, ERC-721, ERC-2612, ERC-2771, ERC-1271 ditulis sendiri di `piutangchain-contracts/contracts/utils` dan `libraries`).

> Kode ada di [`piutangchain-contracts/`](../piutangchain-contracts/). Dokumen ini mengikuti kode; kalau berbeda, **kode yang benar** dan dokumen perlu diperbarui.
> Belum diaudit. Primitif kripto tulisan sendiri adalah risiko terbesar; cocok untuk Sepolia/prototipe saja.

## Contracts

| Contract | Fungsi |
|----------|--------|
| `DebtManager` | Inti: verifikasi 2 signature EIP-712, escrow, aktivasi + mint, jadwal cicilan, denda, pembayaran, PAID + burn, dispute, freeze, revisi |
| `DebtNote` | Token piutang ERC-721 **non-transferable** (juga ERC-5192 `locked`). `tokenId = uint256(noteId)`. Hanya `DebtManager` yang boleh mint/burn. `tokenURI` berisi metadata on-chain (noteId, docHash, pokok, jatuh tempo, kreditur, debitur, status) |
| `MockIDRX` | Stablecoin IDR tiruan: ERC-20 + permit (EIP-2612). **2 desimal** (default deploy). `faucet()` publik, sekali per 24 jam per alamat; `mint()` khusus owner |
| `PiutangForwarder` | Forwarder ERC-2771 untuk gasless. Mendukung EOA dan smart account (ERC-1271). Seluruh tx batal jika relayer memberi gas kurang dari `req.gas` |

## Status

```solidity
enum Status { NONE, ACTIVE, OVERDUE, PAID, DISPUTED, FROZEN }
```

- Yang **disimpan**: `ACTIVE`, `PAID`, `DISPUTED`, `FROZEN`. `NONE` = belum ada.
- **OVERDUE tidak disimpan**: `statusOf()` mengembalikan OVERDUE bila status tersimpan ACTIVE, belum lunas, dan ada tunggakan cicilan **atau** denda belum dibayar. Tidak butuh keeper atau tx `markOverdue`, dan **tidak ada event** saat sebuah piutang menjadi OVERDUE.
- `DRAFT`, `PENDING_SIGNATURE`, `AWAITING_DISBURSEMENT`, `REJECTED`, `CANCELLED` hanya ada di backend: piutang baru lahir on-chain saat aktivasi.

## Struct yang Ditandatangani (EIP-712)

Domain: `{ name: "PiutangChain", version: "1", chainId, verifyingContract: <DebtManager> }`. Backend dan frontend **wajib** memakai `piutangchain-contracts/helpers/eip712.js` (urutan dan tipe field menentukan hash).

```solidity
struct Note {               // ditandatangani kreditur DAN debitur (pesan identik)
    bytes32 noteId;         // keccak256(uuid) dari backend
    uint32  version;
    address creditor;
    address debtor;
    bytes32 docHash;        // canonical payload + hash dokumen pendukung (lihat 05-TECH-SPEC)
    bytes32 scheduleHash;   // keccak256(abi.encode(uint64[] dueDates, uint256[] amounts))
    uint256 principal;      // pokok, satuan terkecil token
    uint256 totalOwed;      // pokok + bunga = jumlah semua cicilan
    uint16  lateFeeBps;     // 0 atau 200 (2% per 30 hari)
    uint64  dueDate;        // jatuh tempo cicilan terakhir
    uint8   disbursement;   // 0 = ONCHAIN (escrow), 1 = OFFCHAIN
    uint64  deadline;       // batas aktivasi
    uint256 creditorNonce;  // acak, sekali pakai per signer
    uint256 debtorNonce;    // acak, sekali pakai per signer
}

struct DisbursementReceipt { bytes32 noteHash; bytes32 proofHash; uint256 amount; uint256 nonce; uint64 deadline; } // debitur
struct PaymentConfirmation { bytes32 noteId; uint256 amount; bytes32 proofHash; uint32 installmentIndex; uint256 nonce; uint64 deadline; bool settleFull; } // kreditur
struct Amendment { bytes32 noteId; uint32 newVersion; bytes32 newDocHash; bytes32 newScheduleHash; uint256 newTotalOwed; uint16 newLateFeeBps; uint64 newDueDate; uint64 deadline; uint256 creditorNonce; uint256 debtorNonce; } // keduanya

struct Schedule { uint64[] dueDates; uint256[] amounts; } // TIDAK ditandatangani; dicocokkan dengan scheduleHash
```

**Nonce unordered:** `nonceUsed[signer][nonce]`. Satu wallet boleh punya banyak piutang menunggu tanda tangan dan banyak konfirmasi sekaligus. `cancelNonce(nonce)` membatalkan signature yang belum dipakai. `receipt.nonce` harus berbeda dari `debtorNonce` (keduanya milik debitur).

**Jadwal** (`_validateSchedule`): 1–24 cicilan, panjang `dueDates` = `amounts`, cocok dengan `scheduleHash`, tanggal urut naik, nominal > 0, Σ `amounts` = `totalOwed`, tanggal terakhir = `dueDate`. Saat aktivasi, cicilan pertama harus di masa depan; saat revisi boleh ada tanggal lampau.

## Alur → Fungsi

| Alur (PRD) | Fungsi | Pemanggil |
|------------|--------|-----------|
| Kreditur tanda tangan + setor pokok ke escrow | `depositEscrow(note, sigCreditor, permit)` | siapa saja (relayer); otorisasi = signature Note + permit kreditur |
| Kreditur menarik escrow sebelum aktif | `refundEscrow(note)` | kreditur. **Ikut membatalkan `creditorNonce`**, supaya signature lama tidak bisa dipakai menyetor ulang |
| Debitur tanda tangan → mint, escrow cair, ACTIVE | `activateOnchain(note, schedule, sigC, sigD)` | siapa saja (relayer) |
| Pencairan off-chain: debitur konfirmasi terima dana → mint, ACTIVE | `activateOffchain(note, schedule, sigC, sigD, receipt, sigReceipt)` | siapa saja (relayer) |
| Bayar on-chain | `payOnchain(noteId, amount, installmentIndex, permit)` | debitur (langsung atau lewat forwarder) |
| Bayar off-chain, dikonfirmasi kreditur | `recordOffchainPayment(confirmation, sigCreditor)` | siapa saja (relayer) |
| Kreditur mengikhlaskan sisa | `markPaid(noteId)` | kreditur |
| Revisi setelah aktif | `amend(amendment, schedule, sigC, sigD)` | siapa saja (relayer) |
| Ajukan / tutup sengketa | `openDispute(noteId, reasonHash)` / `closeDispute(noteId, resolutionHash)` | kreditur atau debitur / `ADMIN_ROLE` |
| Bekukan / buka | `freeze(noteId, reasonHash)` / `unfreeze(noteId, resolutionHash)` | `ADMIN_ROLE` atau `FREEZER_ROLE` / `ADMIN_ROLE` |
| Batalkan signature | `cancelNonce(nonce)` | signer itu sendiri |
| Darurat | `pause()` / `unpause()` | `ADMIN_ROLE` |

### Aturan per fungsi

- **Aktivasi** (dua-duanya): `deadline` belum lewat, field valid (`creditor ≠ debtor`, `principal > 0`, `totalOwed ≥ principal`, `lateFeeBps` 0 atau 200, `dueDate` di masa depan), `noteId` dan `docHash` belum pernah dipakai, dua signature valid, kedua nonce dipakai, jadwal valid. On-chain: escrow harus = `principal`, lalu dana dikirim ke debitur di tx yang sama. Off-chain: `receipt.noteHash` = struct hash Note dan `receipt.amount` = `principal`.
- **`payOnchain`**: status tersimpan ACTIVE atau DISPUTED. `amount` adalah **batas maksimal**: jika melebihi sisa utang, yang ditarik hanya sisa utang (denda bertambah per detik, jadi "bayar lunas" tidak bisa ditebak tepat). Permit cukup sebesar `amount`.
- **`recordOffchainPayment`**: status tersimpan ACTIVE (termasuk yang terhitung OVERDUE). `proofHash` unik per piutang. Kelebihan bayar **ditolak** (`Overpayment`), karena kreditur menandatangani nominal yang benar-benar diterima.
  - **`settleFull`** (ditandatangani kreditur): konfirmasi senilai `remaining()` saat tanda tangan baru dieksekusi beberapa detik kemudian, sehingga denda yang bertambah menyisakan sisa kecil dan piutang tetap OVERDUE. Bila `settleFull = true`, `amount` harus menutup **seluruh sisa cicilan** dan selisih ke total sisa (hanya berupa denda) harus ≤ `SETTLE_TOLERANCE` (denda 1 hari dari tunggakan saat itu: `tunggakan × 200 × 1 hari / (10.000 × 30 hari)`). Selisih itu dihapus (`LateFeeWaived`), lalu pembayaran melunasi (PAID + burn). Kalau syarat tidak terpenuhi → revert `SettleToleranceExceeded(shortfall, tolerance)`. Pokok/cicilan tidak pernah dihapus. `settleFull = false` = perilaku lama.
- **`markPaid`**: hanya ACTIVE. Denda dihitung dulu, sisa diikhlaskan (`NoteMarkedPaid.waived`), lalu PAID + burn.
- **`amend`**: ACTIVE atau DISPUTED; `newVersion` = versi + 1; `newDocHash` belum pernah dipakai; pokok tidak bisa diubah. Denda yang sudah berjalan dihitung dengan syarat lama dan tetap terutang. Jika total baru ≤ yang sudah dibayar dan tidak ada denda → lunas.
- **`openDispute`**: hanya dari status tersimpan ACTIVE (termasuk OVERDUE). **`closeDispute`** mengembalikan ke ACTIVE (OVERDUE lagi bila masih ada tunggakan); jika lunas selama sengketa, PAID + burn di tx itu.
- **`freeze`**: dari ACTIVE atau DISPUTED (PAID sudah final). **`unfreeze`** mengembalikan status sebelum beku; jika ACTIVE dan sudah lunas, PAID + burn. Piutang yang belum aktif tidak ada on-chain, jadi freeze sebelum mint hanya di DB (BR, [03-BUSINESS-RULES](03-BUSINESS-RULES.md)).
- **Pause** menahan deposit, aktivasi, pembayaran, revisi, dan markPaid. Refund escrow, dispute, dan freeze tetap jalan.

| Saat status… | Bayar on-chain | Konfirmasi off-chain | markPaid | Revisi | Dispute baru | Burn |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| ACTIVE / OVERDUE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ saat lunas |
| DISPUTED | ✅ | ❌ | ❌ | ✅ | ❌ | ditahan sampai `closeDispute` |
| FROZEN | ❌ | ❌ | ❌ | ❌ | ❌ | ditahan sampai `unfreeze` |
| PAID | ❌ | ❌ | ❌ | ❌ | ❌ | sudah |

## Denda (2% per Bulan)

- Tarif tetap **2% per 30 hari** (`LATE_FEE_BPS = 200`, `LATE_FEE_PERIOD = 30 days`) dari **tunggakan** (cicilan yang lewat jatuh tempo dan belum dibayar), tidak majemuk. `lateFeeBps` hanya boleh 0 atau 200 (`InvalidLateFee`).
- Pro-rata per detik, dipotong per jatuh tempo:
  `denda = Σ tunggakan_segmen × durasi_segmen × 200 / (10.000 × 30 hari)`.
- Disimpan di checkpoint (`_accrue`) setiap kali pembayaran, markPaid, revisi, dispute, freeze/unfreeze, atau `accrue(noteId)` publik dipanggil. **Sisa pembagian disimpan di `feeRemainder`** dan dibawa ke checkpoint berikutnya, jadi totalnya sama berapa kali pun `accrue` dipanggil.
- Denda **tidak berjalan** saat DISPUTED atau FROZEN.
- Contoh: cicilan Rp400.000 terlambat 15 hari → `400.000 × 2% × 15/30` = Rp4.000.

## Alokasi Pembayaran

Setiap pembayaran (on-chain atau off-chain) dialokasikan berurutan (BR-19):

1. **Tunggakan** cicilan yang sudah jatuh tempo, tertua dulu (menambah `scheduledPaid`).
2. **Denda** (`lateFeeAccrued`).
3. **Cicilan berikutnya** yang belum jatuh tempo.

Sisa utang = `totalOwed − scheduledPaid + denda`. Jika jadi 0 → `fullyPaid`; PAID + burn di tx yang sama, kecuali sedang DISPUTED (burn menunggu `closeDispute`).

## View

| Fungsi | Isi |
|--------|-----|
| `getNote(noteId)` | `NoteView`: pihak, hash, pokok, total, `lateFeeBps`, `lateFeeAccrued` (termasuk berjalan), `scheduledPaid`, `paid`, `dueDate`, status terhitung, `fullyPaid` |
| `getSchedule(noteId)` | `dueDates[]`, `amounts[]` |
| `statusOf(noteId)` | Status termasuk OVERDUE terhitung |
| `remaining(noteId)` / `requiredAmount(noteId)` | Sisa utang sekarang / sudah dibayar + sisa |
| `overdueAmount(noteId)` / `lateFeeOf(noteId)` | Tunggakan / denda belum dibayar |
| `verifyHash(noteId, docHash)` | `true` jika `docHash` hasil hitung ulang sama dengan on-chain |
| `noteHash(note)` | Struct hash Note (kunci escrow, isi `receipt.noteHash`) |
| `nonceUsed(signer, nonce)`, `escrowOf(noteHash)`, `noteIdOfDocHash(docHash)`, `proofUsed(noteId, proofHash)` | Mapping publik |

## Events

Semua event memakai `noteId` (ter-index); **setiap perubahan status tersimpan** memancarkan `StatusChanged`. Kunci idempotency indexer: `(txHash, logIndex)`.

```solidity
event StatusChanged(bytes32 indexed noteId, Status from, Status to, address indexed actor);
event EscrowDeposited(bytes32 indexed noteId, bytes32 indexed noteHash, address indexed creditor, uint256 amount);
event EscrowRefunded(bytes32 indexed noteId, bytes32 indexed noteHash, address indexed creditor, uint256 amount);
event NoteActivated(bytes32 indexed noteId, address indexed creditor, address indexed debtor, bytes32 noteHash, bytes32 docHash, uint256 principal, uint256 totalOwed, uint64 dueDate, Disbursement disbursement);
event PaymentRecorded(bytes32 indexed noteId, uint256 amount, uint256 paidTotal, uint256 remaining, bool onchain, uint32 installmentIndex, bytes32 proofHash, uint256 toLateFee);
event LateFeeAccrued(bytes32 indexed noteId, uint256 amount, uint256 totalAccrued);
event LateFeeWaived(bytes32 indexed noteId, uint256 amount);              // sisa denda dihapus oleh settleFull
event NoteSettled(bytes32 indexed noteId, uint256 paidTotal);           // PAID + burn
event NoteMarkedPaid(bytes32 indexed noteId, address indexed creditor, uint256 waived);
event NoteAmended(bytes32 indexed noteId, uint32 newVersion, bytes32 oldDocHash, bytes32 newDocHash, bytes32 newScheduleHash, uint256 newTotalOwed, uint16 newLateFeeBps, uint64 newDueDate);
event DisputeOpened(bytes32 indexed noteId, address indexed by, bytes32 reasonHash);
event DisputeClosed(bytes32 indexed noteId, address indexed by, bytes32 resolutionHash);
event NoteFrozen(bytes32 indexed noteId, address indexed by, bytes32 reasonHash);
event NoteUnfrozen(bytes32 indexed noteId, address indexed by, bytes32 resolutionHash, Status restoredTo);
event NonceCancelled(address indexed signer, uint256 nonce);
```

`DebtNote` memancarkan `Transfer` (mint/burn) dan `Locked(tokenId)`.

## Gasless

- Semua aksi pengguna (bayar, dispute, markPaid, cancelNonce, refund) bisa dikirim lewat `PiutangForwarder.execute(ForwardRequest, signature)`: pengguna menandatangani `ForwardRequest { from, to, gas, nonce, deadline, data }`, relayer membayar gas, `_msgSender()` = pengguna. Nonce forwarder berurutan per alamat (`forwarder.nonces(from)`).
- Aksi yang otorisasinya sudah dari signature (aktivasi, deposit escrow, konfirmasi off-chain, revisi) dikirim relayer langsung, tanpa forwarder.
- Stablecoin bergerak lewat **permit** (EOA). Permit dibungkus try/catch: kalau di-front-run, transaksi tetap jalan selama allowance cukup. Smart account membayar dengan `approve` dulu lalu `permit.deadline = 0`.
- Bayar on-chain lewat forwarder: tanda tangani permit dulu, lalu ForwardRequest yang `data`-nya `payOnchain(noteId, amount, installmentIndex, permit)` (calldata memuat signature permit).

## Role

| Role | Pemegang | Boleh |
|------|----------|-------|
| `DEFAULT_ADMIN_ROLE` | Multisig tim (default: deployer) | Grant/revoke role |
| `ADMIN_ROLE` | Admin platform | `closeDispute`, `freeze`, `unfreeze`, `pause`, `unpause` |
| `FREEZER_ROLE` | Wallet integrity checker | **Hanya** `freeze` (kalau bocor, paling buruk piutang dibekukan lalu dibuka admin) |

Tidak ada role relayer: fungsi yang dikirim relayer diotorisasi oleh signature pengguna. Tidak ada fungsi admin untuk mengubah isi perjanjian atau memindahkan dana.

## Errors

`ZeroAddress`, `NoteNotFound`, `NoteAlreadyExists`, `DocHashAlreadyUsed`, `InvalidParties`, `InvalidAmount`, `InvalidDueDate`, `WrongDisbursement`, `SignatureExpired`, `InvalidSignature(signer)`, `NonceAlreadyUsed(signer, nonce)`, `EscrowMissing`, `EscrowAlreadyDeposited`, `NotParty`, `NotCreditor`, `NotDebtor`, `InvalidStatus(current)`, `AlreadyFullyPaid`, `Overpayment(remaining)`, `ProofAlreadyUsed`, `ReceiptMismatch`, `InvalidVersion(expected)`, `UnexpectedTransferAmount`, `InvalidLateFee`, `InvalidSchedule`, `ScheduleMismatch`, `SettleToleranceExceeded(shortfall, tolerance)`, plus `AccessControlUnauthorizedAccount`, `EnforcedPause`, dan `Soulbound` (DebtNote).

## Keterbatasan

- Kalau kreditur tidak mau menandatangani konfirmasi padahal debitur sudah transfer, kontrak tidak bisa memaksa. Jalurnya dispute lalu revisi bertanda tangan.
- Stablecoin fee-on-transfer ditolak (`UnexpectedTransferAmount`). Kontrak tidak upgradeable. ERC-4337/paymaster tidak diimplementasikan.
- Satu key `ADMIN_ROLE` bisa membekukan piutang mana pun: pakai multisig.
