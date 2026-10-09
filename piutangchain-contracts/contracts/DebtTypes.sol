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
    bytes32 scheduleHash; //  hash jadwal cicilan (detail jadwal ada di off-chain)
    uint256 principal; //     nominal pokok (satuan terkecil stablecoin)
    uint256 totalOwed; //     pokok + bunga/fee yang disepakati (dihitung off-chain, ditandatangani)
    uint256 lateFee; //       denda flat sekali, berlaku jika lewat jatuh tempo (0 = tidak ada)
    uint64 dueDate; //        jatuh tempo akhir (unix detik)
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
    uint256 newLateFee;
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
