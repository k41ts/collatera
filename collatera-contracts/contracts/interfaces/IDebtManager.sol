// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDebtManager {
    /// @dev Status on-chain. OVERDUE tidak disimpan: dihitung dari dueDate saat dibaca.
    ///      Status DRAFT, PENDING_SIGNATURE, REJECTED, CANCELLED hidup di backend (belum ada token).
    enum Status {
        NONE,
        ACTIVE,
        OVERDUE,
        PAID,
        DISPUTED,
        FROZEN
    }

    enum Disbursement {
        ONCHAIN,
        OFFCHAIN
    }

    struct NoteView {
        bytes32 noteId;
        uint32 version;
        address creditor;
        address debtor;
        bytes32 docHash;
        bytes32 scheduleHash;
        uint256 principal;
        uint256 totalOwed;
        uint16 lateFeeBps;
        uint256 lateFeeAccrued; // denda yang belum dibayar, termasuk yang berjalan sampai saat ini
        uint256 scheduledPaid; //  bagian pembayaran yang sudah dialokasikan ke cicilan
        uint256 paid; //           total semua pembayaran (cicilan + denda)
        uint64 dueDate;
        Disbursement disbursement;
        Status status;
        bool fullyPaid;
    }

    function getNote(bytes32 noteId) external view returns (NoteView memory);
}
