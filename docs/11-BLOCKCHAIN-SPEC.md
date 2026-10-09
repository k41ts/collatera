# 11 — Blockchain Specification

Chain: **Ethereum Sepolia** (`chainId 11155111`) · Solidity `^0.8.24` · OpenZeppelin v5.

## Contracts

| Contract | Standar | Fungsi |
|----------|---------|--------|
| `PiutangNote` | ERC-721, EIP-712, ERC-2771 | Token piutang, escrow, repayment, freeze |
| `MockIDR` | ERC-20 + EIP-2612 permit | Stablecoin IDR tiruan, 18 desimal, `faucet(to)` khusus `MINTER_ROLE` (relayer) |
| `Forwarder` | ERC2771Forwarder | Meta-tx gasless lewat relayer |

## Data On-chain per Token

```solidity
enum Status { ACTIVE, OVERDUE, DISPUTED, FROZEN, PAID }

struct Note {
    bytes32   noteId;
    bytes32   termsHash;          // EIP-712 struct hash DebtNote
    bytes32   docHash;
    address   creditor;
    address   debtor;
    uint256   principal;
    uint64[]  dueDates;           // jadwal cicilan, urut naik, maks 24
    uint256[] amounts;            // Σ amounts = principal + interestAmount
    uint256   scheduledPaid;      // total yang sudah dialokasikan ke cicilan
    uint16    lateFeeBps;         // 0 atau 200 (2% per 30 hari)
    uint256   lateFeeAccrued;     // late fee yang belum dibayar
    uint64    lastAccrualAt;      // checkpoint perhitungan late fee
    Status    status;
    Status    statusBeforeFreeze;
}

mapping(uint256 => Note) internal notes;         // tokenId → Note, dibaca lewat getter
mapping(bytes32 => bool) public usedDocHash;
mapping(address => mapping(uint256 => bool)) public usedNonces; // unordered nonce, dipakai DebtNote & OffchainPayment
```

Tidak ada nama, email, HP, atau isi dokumen di contract.

Turunan yang dihitung contract (view):

- `dueBy(t)` = Σ `amounts[i]` dengan `dueDates[i] ≤ t` (cicilan yang sudah jatuh tempo).
- `overdueAmount()` = `max(0, dueBy(now) − scheduledPaid)`.
- `outstanding()` = `Σ amounts − scheduledPaid + lateFeeAccrued + pendingLateFee()`.

## Status OVERDUE per Cicilan

Jadwal cicilan disimpan on-chain saat mint (`dueDates[]`, `amounts[]`, dicek terhadap `scheduleHash` di `terms`), sehingga contract dan DB memakai definisi yang sama:

- **OVERDUE** jika `overdueAmount() > 0` atau `lateFeeAccrued > 0` (tunggakan atau late fee belum dibayar).
- `markOverdue(tokenId)` mengubah ACTIVE → OVERDUE bila kondisi di atas terpenuhi. Cron memanggilnya tiap hari untuk setiap cicilan yang baru lewat jatuh tempo; tx-nya **diantrekan ke relayer worker dan dikirim dengan wallet relayer** (`CHAIN_TXS.kind = overdue`), supaya nonce tx wallet relayer tetap dikelola satu `NonceManager`.
- Setelah `repay`/`confirmOffchainPayment`, jika kondisi OVERDUE tidak lagi terpenuhi, status kembali OVERDUE → ACTIVE otomatis.
- Status di DB **tidak** diset sendiri oleh cron; DB mengikuti event `StatusChanged` dari indexer. `INSTALLMENTS.status` di DB hanya tampilan per cicilan.

## Late Fee (2% per Bulan)

- Tarif tetap **2% per 30 hari** (`lateFeeBps = 200`) dari cicilan yang terlambat, **tidak berbunga majemuk**. Nilai `lateFeeBps` hanya boleh `0` (tidak disepakati) atau `200`; selain itu `mintNote` revert `InvalidTerms`.
- Dihitung pro-rata per detik:
  `fee = Σ_segmen overdueAmount_segmen × lateFeeBps × durasi_segmen / (10_000 × 30 days)`,
  dengan segmen dipotong di setiap `dueDate` di antara `lastAccrualAt` dan `now` (maks 24 iterasi, hasilnya tepat walau cron telat).
- `_accrue()` dijalankan di awal `repay`, `confirmOffchainPayment`, `markOverdue`, `setDisputed`, `freeze`, `unfreeze`, dan fungsi publik `accrue(tokenId)`; lalu `lastAccrualAt = now`.
- Late fee **tidak bertambah** selama DISPUTED atau FROZEN (segmen itu dilewati).
- Contoh: cicilan Rp2.500.000 terlambat 15 hari → `2.500.000 × 2% × 15/30` = Rp25.000.

## Alokasi Pembayaran

Setiap pembayaran (on-chain atau off-chain) dialokasikan berurutan, sesuai BR-19:

1. **Tunggakan**: cicilan yang sudah jatuh tempo dan belum lunas, tertua dulu (sampai `overdueAmount()`, menambah `scheduledPaid`).
2. **Late fee**: `lateFeeAccrued`.
3. **Cicilan berikutnya** yang belum jatuh tempo, tertua dulu (menambah `scheduledPaid`).

Dengan urutan ini late fee lunas sebelum debitur bisa membayar di muka, sehingga status tidak tertahan OVERDUE karena sisa late fee di akhir tenor.

`amount` tidak boleh melebihi `outstanding()` setelah `_accrue()` (BR-20). Jika `outstanding()` menjadi 0 → status PAID + burn dalam tx yang sama, kecuali sedang DISPUTED.

## Fungsi

| Fungsi | Pemanggil | Aturan |
|--------|-----------|--------|
| `mintNote(DebtNote terms, uint64[] dueDates, uint256[] amounts, bytes sigCreditor, bytes sigDebtor, Permit escrowPermit)` | `RELAYER_ROLE` | Verifikasi 2 signature, deadline, `usedNonces[creditor][nonce]` dan `usedNonces[debtor][nonce]` belum terpakai lalu ditandai terpakai; `keccak256(abi.encode(dueDates, amounts)) == terms.scheduleHash`; `Σ amounts == principal + interestAmount`; `docHash` belum dipakai; jika `disbursement` on-chain: tarik escrow via permit lalu transfer ke debitur; mint ke kreditur dengan status ACTIVE |
| `repay(uint256 tokenId, uint256 amount, Permit permit)` | debitur lewat `Forwarder` (ERC-2771, `_msgSender()` = debitur, tx dikirim relayer) | Status ACTIVE/OVERDUE/DISPUTED; `_accrue()`; `amount ≤ outstanding()`; transfer IDR debitur → kreditur; alokasi; perbarui status; jika 0 dan bukan DISPUTED → PAID + burn |
| `confirmOffchainPayment(OffchainPayment p, bytes sigCreditor)` | `RELAYER_ROLE` | Signature EIP-712 kreditur valid, belum lewat `deadline`, `usedNonces[creditor][nonce]` belum terpakai lalu ditandai terpakai; status ACTIVE/OVERDUE; `_accrue()`; `amount ≤ outstanding()`; alokasi; perbarui status; jika 0 → PAID + burn |
| `markOverdue(uint256 tokenId)` | siapa saja; dalam praktik cron lewat wallet relayer | `_accrue()`; status ACTIVE dan kondisi OVERDUE terpenuhi |
| `accrue(uint256 tokenId)` | siapa saja | Checkpoint late fee (untuk tampilan sisa utang yang akurat) |
| `setDisputed(uint256 tokenId, bool open)` | `GUARDIAN_ROLE` | Buka: `_accrue()`, status ACTIVE/OVERDUE → DISPUTED. Tutup: status dihitung ulang → PAID + burn jika `outstanding() == 0`, OVERDUE jika kondisi OVERDUE terpenuhi, selain itu ACTIVE |
| `freeze(uint256 tokenId)` / `unfreeze` | `GUARDIAN_ROLE` | Freeze token dari status apa pun selain PAID, simpan `statusBeforeFreeze`. Piutang yang belum di-mint (DRAFT, PENDING_SIGNATURE, AWAITING_DISBURSEMENT) dibekukan di DB saja, lihat [03-BUSINESS-RULES](03-BUSINESS-RULES.md). Unfreeze: jika sebelumnya DISPUTED kembali DISPUTED; selain itu status dihitung ulang seperti saat dispute ditutup |
| `getNote(uint256 tokenId) view` / `outstanding(uint256 tokenId) view` | siapa saja | Data note termasuk jadwal; sisa utang termasuk late fee berjalan |
| `verify(uint256 tokenId, bytes32 termsHash, bytes32 docHash) view` | siapa saja | Return `true` jika cocok |
| `pause()` / `unpause()` | `DEFAULT_ADMIN_ROLE` | Darurat |

Saat DISPUTED: `repay` tetap jalan, tapi burn ditunda; `confirmOffchainPayment` ditolak.

### Bayar on-chain lewat Forwarder

`repay` dipanggil lewat `Forwarder.execute(ForwardRequest)` sehingga debitur menandatangani **dua** pesan EIP-712, keduanya tanpa gas:

1. **Permit** MockIDR (`owner` = debitur, `spender` = PiutangNote, `value` = `amount`, `deadline`).
2. **ForwardRequest** (`from` = debitur, `to` = PiutangNote, `data` = calldata `repay(tokenId, amount, permit)` yang sudah berisi signature permit, `nonce` = `Forwarder.nonces(debitur)`, `deadline`).

Urutannya harus permit dulu, karena calldata ForwardRequest memuat signature permit. Backend memeriksa bahwa `data` benar-benar `repay` untuk piutang dan nominal yang diminta sebelum relayer mengirim `execute`.

### Siapa memicu burn setelah dispute

Burn yang tertunda dijalankan **di dalam** `setDisputed(tokenId, false)`. Alurnya: admin menutup dispute di `POST /admin/disputes/:id/close` → backend mengantrekan tx `setDisputed(false)` (`CHAIN_TXS.kind = dispute`) → worker mengirimnya dengan wallet `GUARDIAN_PRIVATE_KEY` → jika `outstanding() == 0`, contract set PAID dan burn di tx yang sama, memancarkan `StatusChanged` dan `NoteBurned` → indexer memperbarui DB dan notifier mengirim bukti lunas.

### Pencairan off-chain

Contract **tidak** punya status "menunggu pencairan". Untuk `disbursement = off-chain`, `mintNote` baru dipanggil **setelah** debitur mengonfirmasi terima dana; sebelum itu piutang hanya ada di DB dengan status `AWAITING_DISBURSEMENT` (lihat [03-BUSINESS-RULES](03-BUSINESS-RULES.md)). Karena itu `deadline` signature untuk pencairan off-chain diset 14 hari; jika lewat sebelum dikonfirmasi, kedua pihak menandatangani ulang.

## Events

```solidity
event NoteMinted(uint256 indexed tokenId, bytes32 indexed noteId, address creditor, address debtor, bytes32 termsHash, bytes32 docHash);
event Repaid(uint256 indexed tokenId, uint256 amount, uint256 toInstallments, uint256 toLateFee, uint256 outstanding, bool onchain);
event LateFeeAccrued(uint256 indexed tokenId, uint256 amount, uint256 totalAccrued);
event StatusChanged(uint256 indexed tokenId, Status from, Status to);
event NoteBurned(uint256 indexed tokenId);
```

## Non-transferable

```solidity
function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0)) revert NonTransferable();
    return super._update(to, tokenId, auth);
}
```

## Gasless

- Tanda tangan perjanjian & konfirmasi: **EIP-712 off-chain**, dikirim relayer.
- Pergerakan stablecoin: **EIP-2612 permit**, sehingga debitur/kreditur tidak perlu `approve` (tx bergas).
- Relayer membayar gas Sepolia ETH; antrean + retry di BullMQ.

## Custom Errors

`InvalidSignature`, `SignatureExpired`, `NonceUsed`, `InvalidTerms`, `ScheduleMismatch`, `DocHashUsed`, `NoteFrozen`, `InvalidStatus`, `NotOverdue`, `AmountExceedsOutstanding`, `NonTransferable`.
