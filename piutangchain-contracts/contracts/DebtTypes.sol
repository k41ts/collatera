// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Struct yang ditandatangani (EIP-712). Urutan dan tipe field HARUS sama dengan typestring di DebtManager
///         dan helpers/eip712.js, karena hash dihitung dengan abi.encode(TYPEHASH, struct).

/// @dev Perjanjian utang. Ditandatangani kreditur DAN debitur (signature yang sama persis).
struct Note {
    bytes32 noteId; //        id unik dari backend
    uint32 version; //        versi revisi draft saat ditandatangani
    address creditor;
    address debtor;
    bytes32 docHash; //       keccak256 dari canonical payload + hash dokumen pendukung
    bytes32 scheduleHash; //  keccak256(abi.encode(uint64[] dueDates, uint256[] amounts)), lihat Schedule
    uint256 principal; //     nominal pokok (satuan terkecil stablecoin)
    uint256 totalOwed; //     pokok + bunga yang disepakati (= jumlah semua cicilan)
    uint16 lateFeeBps; //     0 (tanpa denda) atau 200 (2% per 30 hari dari cicilan yang terlambat)
    uint64 dueDate; //        jatuh tempo akhir (unix detik) = jatuh tempo cicilan terakhir
    uint8 disbursement; //    0 = ONCHAIN, 1 = OFFCHAIN
    uint64 deadline; //       batas waktu signature untuk aktivasi
    uint256 creditorNonce;
    uint256 debtorNonce;
}

/// @dev Debitur mengonfirmasi menerima pokok (pencairan off-chain). Ditandatangani debitur.
struct DisbursementReceipt {
    bytes32 noteHash; //   struct hash Note yang disepakati
    bytes32 proofHash; //  hash bukti transfer (off-chain)
    uint256 amount; //     harus == principal
    uint256 nonce;
    uint64 deadline;
}

/// @dev Kreditur mengonfirmasi menerima pembayaran off-chain. Ditandatangani kreditur.
struct PaymentConfirmation {
    bytes32 noteId;
    uint256 amount;
    bytes32 proofHash; //  hash bukti transfer; unik per piutang (idempotency)
    uint32 installmentIndex;
    uint256 nonce;
    uint64 deadline;
}

/// @dev Revisi setelah ACTIVE. Ditandatangani ulang kreditur DAN debitur. Pokok tidak bisa diubah.
struct Amendment {
    bytes32 noteId;
    uint32 newVersion; //  harus versi saat ini + 1
    bytes32 newDocHash;
    bytes32 newScheduleHash;
    uint256 newTotalOwed;
    uint16 newLateFeeBps;
    uint64 newDueDate;
    uint64 deadline;
    uint256 creditorNonce;
    uint256 debtorNonce;
}

/// @dev Data ERC-2612 permit (bukan diteken ke DebtManager; diteruskan ke stablecoin). deadline == 0 → lewati permit.
struct Permit {
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

/// @dev Jadwal cicilan. TIDAK ditandatangani langsung: kontrak mencocokkan
///      keccak256(abi.encode(dueDates, amounts)) dengan scheduleHash yang sudah ditandatangani kedua pihak.
struct Schedule {
    uint64[] dueDates; //  urut naik, maks 24 cicilan; terakhir == dueDate
    uint256[] amounts; //  > 0; jumlahnya == totalOwed
}
