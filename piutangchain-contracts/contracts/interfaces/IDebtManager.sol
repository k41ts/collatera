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
        uint256 lateFee;
        uint256 paid;
        uint64 dueDate;
        Disbursement disbursement;
        Status status;
        bool fullyPaid;
    }

    function getNote(bytes32 noteId) external view returns (NoteView memory);
}
