// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDebtManager} from "./interfaces/IDebtManager.sol";
import {IDebtNote} from "./interfaces/IDebtNote.sol";
import {IERC20Minimal, IERC20Permit} from "./interfaces/IERC20Minimal.sol";
import {Note, DisbursementReceipt, PaymentConfirmation, Amendment, Permit} from "./DebtTypes.sol";
import {EIP712} from "./utils/EIP712.sol";
import {AccessControl} from "./utils/AccessControl.sol";
import {ReentrancyGuard} from "./utils/ReentrancyGuard.sol";
import {Pausable} from "./utils/Pausable.sol";
import {ERC2771Context} from "./utils/ERC2771Context.sol";
import {SignatureChecker} from "./libraries/SignatureChecker.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";

/// @title DebtManager
/// @notice Inti PiutangChain: verifikasi dua signature EIP-712, mint token piutang (ERC-721 non-transferable) ke
///         kreditur, pencairan pokok (escrow on-chain atau konfirmasi off-chain), pencatatan pembayaran
///         (on-chain / off-chain), OVERDUE, PAID + burn, dispute, freeze, dan revisi bertanda tangan ulang.
///
/// Status on-chain: NONE → ACTIVE → (OVERDUE dihitung) → PAID; ACTIVE ↔ DISPUTED; ACTIVE|DISPUTED ↔ FROZEN.
/// DRAFT / PENDING_SIGNATURE / REJECTED / CANCELLED tidak ada on-chain: piutang baru lahir saat aktivasi.
contract DebtManager is IDebtManager, EIP712, AccessControl, ReentrancyGuard, Pausable, ERC2771Context {
    using TransferHelper for address;

    // ------------------------------------------------------------------ roles
    /// @dev Admin platform: tutup dispute, buka freeze, freeze, pause.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @dev Key integrity checker: HANYA boleh freeze. Tidak bisa unfreeze/tutup dispute.
    bytes32 public constant FREEZER_ROLE = keccak256("FREEZER_ROLE");

    // ------------------------------------------------------------- typehashes
    bytes32 public constant NOTE_TYPEHASH =
        keccak256(
            "Note(bytes32 noteId,uint32 version,address creditor,address debtor,bytes32 docHash,bytes32 scheduleHash,uint256 principal,uint256 totalOwed,uint256 lateFee,uint64 dueDate,uint8 disbursement,uint64 deadline,uint256 creditorNonce,uint256 debtorNonce)"
        );
    bytes32 public constant RECEIPT_TYPEHASH =
        keccak256("DisbursementReceipt(bytes32 noteHash,bytes32 proofHash,uint256 amount,uint256 nonce,uint64 deadline)");
    bytes32 public constant PAYMENT_TYPEHASH =
        keccak256(
            "PaymentConfirmation(bytes32 noteId,uint256 amount,bytes32 proofHash,uint32 installmentIndex,uint256 nonce,uint64 deadline)"
        );
    bytes32 public constant AMENDMENT_TYPEHASH =
        keccak256(
            "Amendment(bytes32 noteId,uint32 newVersion,bytes32 newDocHash,bytes32 newScheduleHash,uint256 newTotalOwed,uint256 newLateFee,uint64 newDueDate,uint64 deadline,uint256 creditorNonce,uint256 debtorNonce)"
        );

    // ----------------------------------------------------------------- errors
    error ZeroAddress();
    error NoteNotFound();
    error NoteAlreadyExists();
    error DocHashAlreadyUsed();
    error InvalidParties();
    error InvalidAmount();
    error InvalidDueDate();
    error WrongDisbursement();
    error SignatureExpired();
    error InvalidSignature(address signer);
    error NonceAlreadyUsed(address signer, uint256 nonce);
    error EscrowMissing();
    error EscrowAlreadyDeposited();
    error NotParty();
    error NotCreditor();
    error NotDebtor();
    error InvalidStatus(Status current);
    error AlreadyFullyPaid();
    error Overpayment(uint256 remaining);
    error ProofAlreadyUsed();
    error ReceiptMismatch();
    error InvalidVersion(uint32 expected);
    error UnexpectedTransferAmount();

    // ----------------------------------------------------------------- events
    /// @dev Satu event untuk SEMUA perubahan status (audit log / indexer). Detail ada di event spesifik.
    event StatusChanged(bytes32 indexed noteId, Status from, Status to, address indexed actor);
    event EscrowDeposited(bytes32 indexed noteId, bytes32 indexed noteHash, address indexed creditor, uint256 amount);
    event EscrowRefunded(bytes32 indexed noteId, bytes32 indexed noteHash, address indexed creditor, uint256 amount);
    event NoteActivated(
        bytes32 indexed noteId,
        address indexed creditor,
        address indexed debtor,
        bytes32 noteHash,
        bytes32 docHash,
        uint256 principal,
        uint256 totalOwed,
        uint64 dueDate,
        Disbursement disbursement
    );
    event PaymentRecorded(
        bytes32 indexed noteId,
        uint256 amount,
        uint256 paidTotal,
        uint256 remaining,
        bool onchain,
        uint32 installmentIndex,
        bytes32 proofHash
    );
    event NoteSettled(bytes32 indexed noteId, uint256 paidTotal);
    event NoteMarkedPaid(bytes32 indexed noteId, address indexed creditor, uint256 waived);
    event NoteAmended(
        bytes32 indexed noteId,
        uint32 newVersion,
        bytes32 oldDocHash,
        bytes32 newDocHash,
        bytes32 newScheduleHash,
        uint256 newTotalOwed,
        uint256 newLateFee,
        uint64 newDueDate
    );
    event DisputeOpened(bytes32 indexed noteId, address indexed by, bytes32 reasonHash);
    event DisputeClosed(bytes32 indexed noteId, address indexed by, bytes32 resolutionHash);
    event NoteFrozen(bytes32 indexed noteId, address indexed by, bytes32 reasonHash);
    event NoteUnfrozen(bytes32 indexed noteId, address indexed by, bytes32 resolutionHash, Status restoredTo);
    event NonceCancelled(address indexed signer, uint256 nonce);

    // ---------------------------------------------------------------- storage
    struct Record {
        address creditor;
        uint64 dueDate;
        uint32 version;
        address debtor;
        Disbursement disbursement;
        Status status; //             tidak pernah OVERDUE (dihitung di statusOf)
        Status statusBeforeFreeze;
        bool fullyPaid; //            sudah dibayar lunas (burn bisa tertahan saat DISPUTED)
        bytes32 docHash;
        bytes32 scheduleHash;
        uint256 principal;
        uint256 totalOwed;
        uint256 lateFee;
        uint256 paid;
    }

    IDebtNote public immutable debtNote;
    address public immutable stablecoin;

    mapping(bytes32 noteId => Record) private _records;
    /// @dev docHash => noteId. Non-zero berarti hash sudah dipakai (seumur hidup, termasuk hash lama hasil revisi).
    mapping(bytes32 docHash => bytes32 noteId) public noteIdOfDocHash;
    /// @dev noteHash (struct hash Note) => dana pokok yang ditahan escrow.
    mapping(bytes32 noteHash => uint256 amount) public escrowOf;
    mapping(address signer => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(bytes32 noteId => mapping(bytes32 proofHash => bool)) public proofUsed;

    constructor(
        address debtNote_,
        address stablecoin_,
        address forwarder_,
        address admin_
    ) EIP712("PiutangChain", "1") ERC2771Context(forwarder_) {
        if (debtNote_ == address(0) || stablecoin_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        debtNote = IDebtNote(debtNote_);
        stablecoin = stablecoin_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
    }

    function _msgSender() internal view override(AccessControl, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    // =====================================================================
    //                         PENCAIRAN & AKTIVASI
    // =====================================================================

    /// @notice (On-chain) Kreditur menyetor pokok ke escrow saat menandatangani. Dana TIDAK dilepas sebelum
    ///         debitur ikut menandatangani dan `activateOnchain` dipanggil. Siapa saja boleh mengirim (relayer):
    ///         otorisasi kreditur = signature Note + signature permit stablecoin miliknya.
    function depositEscrow(
        Note calldata n,
        bytes calldata sigCreditor,
        Permit calldata permit
    ) external nonReentrant whenNotPaused {
        if (n.disbursement != uint8(Disbursement.ONCHAIN)) revert WrongDisbursement();
        bytes32 nHash = _validateNewNote(n);
        if (nonceUsed[n.creditor][n.creditorNonce]) revert NonceAlreadyUsed(n.creditor, n.creditorNonce);
        _verify(n.creditor, _hashTypedDataV4(nHash), sigCreditor);
        if (escrowOf[nHash] != 0) revert EscrowAlreadyDeposited();

        escrowOf[nHash] = n.principal;
        _permit(n.creditor, n.principal, permit);
        _pull(n.creditor, address(this), n.principal);

        emit EscrowDeposited(n.noteId, nHash, n.creditor, n.principal);
    }

    /// @notice Kreditur menarik kembali dana escrow selama piutang belum aktif. Tetap bisa saat pause.
    function refundEscrow(Note calldata n) external nonReentrant {
        if (_msgSender() != n.creditor) revert NotCreditor();
        bytes32 nHash = _noteHash(n);
        uint256 amount = escrowOf[nHash];
        if (amount == 0) revert EscrowMissing();
        delete escrowOf[nHash];
        stablecoin.safeTransfer(n.creditor, amount);
        emit EscrowRefunded(n.noteId, nHash, n.creditor, amount);
    }

    /// @notice (On-chain) Verifikasi 2 signature, mint token ke kreditur, lepas dana escrow ke debitur, status ACTIVE.
    function activateOnchain(
        Note calldata n,
        bytes calldata sigCreditor,
        bytes calldata sigDebtor
    ) external nonReentrant whenNotPaused {
        if (n.disbursement != uint8(Disbursement.ONCHAIN)) revert WrongDisbursement();
        bytes32 nHash = _validateNewNote(n);
        if (escrowOf[nHash] != n.principal) revert EscrowMissing();
        _verifyAgreement(n, nHash, sigCreditor, sigDebtor);

        delete escrowOf[nHash];
        _open(n, nHash);
        stablecoin.safeTransfer(n.debtor, n.principal);
    }

    /// @notice (Off-chain) Verifikasi 2 signature + konfirmasi terima dana dari debitur, lalu mint token dan ACTIVE.
    ///         Token tidak pernah ter-mint untuk utang yang uangnya belum dikonfirmasi cair.
    function activateOffchain(
        Note calldata n,
        bytes calldata sigCreditor,
        bytes calldata sigDebtor,
        DisbursementReceipt calldata receipt,
        bytes calldata sigReceipt
    ) external nonReentrant whenNotPaused {
        if (n.disbursement != uint8(Disbursement.OFFCHAIN)) revert WrongDisbursement();
        bytes32 nHash = _validateNewNote(n);
        if (receipt.noteHash != nHash || receipt.amount != n.principal) revert ReceiptMismatch();
        if (receipt.deadline < block.timestamp) revert SignatureExpired();
        _verifyAgreement(n, nHash, sigCreditor, sigDebtor);

        _verify(
            n.debtor,
            _hashTypedDataV4(keccak256(abi.encode(RECEIPT_TYPEHASH, receipt))),
            sigReceipt
        );
        _useNonce(n.debtor, receipt.nonce);

        _open(n, nHash);
    }

    // =====================================================================
    //                              PEMBAYARAN
    // =====================================================================

    /// @notice (On-chain) Debitur membayar stablecoin; kontrak meneruskan ke kreditur dan mengurangi sisa utang.
    ///         Tetap diterima saat DISPUTED; ditolak saat FROZEN/PAID.
    function payOnchain(
        bytes32 noteId,
        uint256 amount,
        uint32 installmentIndex,
        Permit calldata permit
    ) external nonReentrant whenNotPaused {
        Record storage r = _get(noteId);
        address payer = _msgSender();
        if (payer != r.debtor) revert NotDebtor();
        if (r.status != Status.ACTIVE && r.status != Status.DISPUTED) revert InvalidStatus(r.status);

        _recordPayment(noteId, r, amount, installmentIndex, true, bytes32(0), payer);
        _permit(payer, amount, permit);
        _pull(payer, r.creditor, amount);
    }

    /// @notice (Off-chain) Pembayaran tercatat setelah kreditur menandatangani konfirmasi.
    ///         Siapa saja boleh mengirim (relayer). Ditahan saat DISPUTED/FROZEN.
    function recordOffchainPayment(
        PaymentConfirmation calldata c,
        bytes calldata sigCreditor
    ) external nonReentrant whenNotPaused {
        Record storage r = _get(c.noteId);
        if (r.status != Status.ACTIVE) revert InvalidStatus(r.status);
        if (c.deadline < block.timestamp) revert SignatureExpired();
        if (c.proofHash == bytes32(0) || proofUsed[c.noteId][c.proofHash]) revert ProofAlreadyUsed();

        _verify(
            r.creditor,
            _hashTypedDataV4(keccak256(abi.encode(PAYMENT_TYPEHASH, c))),
            sigCreditor
        );
        _useNonce(r.creditor, c.nonce);
        proofUsed[c.noteId][c.proofHash] = true;

        _recordPayment(c.noteId, r, c.amount, c.installmentIndex, false, c.proofHash, r.creditor);
    }

    /// @notice Kreditur menandai lunas (mengikhlaskan sisa). Hanya saat ACTIVE.
    function markPaid(bytes32 noteId) external nonReentrant whenNotPaused {
        Record storage r = _get(noteId);
        address caller = _msgSender();
        if (caller != r.creditor) revert NotCreditor();
        if (r.status != Status.ACTIVE) revert InvalidStatus(r.status);

        uint256 waived = _required(r) - r.paid;
        r.fullyPaid = true;
        emit NoteMarkedPaid(noteId, caller, waived);
        _settle(noteId, r, caller);
    }

    // =====================================================================
    //                    REVISI SETELAH AKTIF (2 SIGNATURE)
    // =====================================================================

    /// @notice Ubah isi perjanjian (hash dokumen, jadwal, total, denda, jatuh tempo) lewat revisi yang
    ///         ditandatangani ulang kedua pihak. Pokok tidak bisa diubah. Bisa saat ACTIVE atau DISPUTED.
    function amend(
        Amendment calldata a,
        bytes calldata sigCreditor,
        bytes calldata sigDebtor
    ) external nonReentrant whenNotPaused {
        Record storage r = _get(a.noteId);
        if (r.status != Status.ACTIVE && r.status != Status.DISPUTED) revert InvalidStatus(r.status);
        if (a.newVersion != r.version + 1) revert InvalidVersion(r.version + 1);
        if (a.deadline < block.timestamp) revert SignatureExpired();
        if (a.newDocHash == bytes32(0) || a.newTotalOwed == 0 || a.newDueDate == 0) revert InvalidAmount();
        if (noteIdOfDocHash[a.newDocHash] != bytes32(0)) revert DocHashAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(_amendmentHash(a));
        _verify(r.creditor, digest, sigCreditor);
        _verify(r.debtor, digest, sigDebtor);
        _useNonce(r.creditor, a.creditorNonce);
        _useNonce(r.debtor, a.debtorNonce);

        bytes32 oldDocHash = r.docHash;
        noteIdOfDocHash[a.newDocHash] = a.noteId;
        r.version = a.newVersion;
        r.docHash = a.newDocHash;
        r.scheduleHash = a.newScheduleHash;
        r.totalOwed = a.newTotalOwed;
        r.lateFee = a.newLateFee;
        r.dueDate = a.newDueDate;

        emit NoteAmended(
            a.noteId,
            a.newVersion,
            oldDocHash,
            a.newDocHash,
            a.newScheduleHash,
            a.newTotalOwed,
            a.newLateFee,
            a.newDueDate
        );

        bool due = r.paid >= _required(r);
        r.fullyPaid = due;
        if (due && r.status == Status.ACTIVE) _settle(a.noteId, r, _msgSender());
    }

    // =====================================================================
    //                         DISPUTE, FREEZE, ADMIN
    // =====================================================================

    /// @notice Kreditur atau debitur mengajukan dispute (alasan dan bukti disimpan off-chain; hash-nya dicatat).
    ///         Pembayaran on-chain tetap diterima; burn, konfirmasi off-chain, dan tandai lunas ditahan.
    function openDispute(bytes32 noteId, bytes32 reasonHash) external {
        Record storage r = _get(noteId);
        address caller = _msgSender();
        if (caller != r.creditor && caller != r.debtor) revert NotParty();
        if (r.status != Status.ACTIVE) revert InvalidStatus(r.status);
        _setStatus(noteId, r, Status.DISPUTED, caller);
        emit DisputeOpened(noteId, caller, reasonHash);
    }

    /// @notice Admin menutup dispute. Status kembali ke ACTIVE (OVERDUE otomatis jika lewat jatuh tempo).
    ///         Jika sudah lunas selama dispute, token di-burn sekarang.
    function closeDispute(bytes32 noteId, bytes32 resolutionHash) external onlyRole(ADMIN_ROLE) {
        Record storage r = _get(noteId);
        if (r.status != Status.DISPUTED) revert InvalidStatus(r.status);
        address caller = _msgSender();
        _setStatus(noteId, r, Status.ACTIVE, caller);
        emit DisputeClosed(noteId, caller, resolutionHash);
        if (r.fullyPaid) _settle(noteId, r, caller);
    }

    /// @notice Bekukan piutang (ADMIN atau FREEZER/integrity checker). FROZEN menolak pembayaran, revisi,
    ///         dispute baru, dan burn sampai admin membukanya. Piutang PAID sudah final dan tidak bisa dibekukan.
    function freeze(bytes32 noteId, bytes32 reasonHash) external {
        address caller = _msgSender();
        if (!hasRole(ADMIN_ROLE, caller) && !hasRole(FREEZER_ROLE, caller)) {
            revert AccessControlUnauthorizedAccount(caller, FREEZER_ROLE);
        }
        Record storage r = _get(noteId);
        if (r.status != Status.ACTIVE && r.status != Status.DISPUTED) revert InvalidStatus(r.status);
        r.statusBeforeFreeze = r.status;
        _setStatus(noteId, r, Status.FROZEN, caller);
        emit NoteFrozen(noteId, caller, reasonHash);
    }

    /// @notice Admin membuka freeze setelah data diperbaiki; status kembali ke sebelum dibekukan.
    function unfreeze(bytes32 noteId, bytes32 resolutionHash) external onlyRole(ADMIN_ROLE) {
        Record storage r = _get(noteId);
        if (r.status != Status.FROZEN) revert InvalidStatus(r.status);
        address caller = _msgSender();
        Status restored = r.statusBeforeFreeze;
        _setStatus(noteId, r, restored, caller);
        emit NoteUnfrozen(noteId, caller, resolutionHash, restored);
        if (restored == Status.ACTIVE && r.fullyPaid) _settle(noteId, r, caller);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause(_msgSender());
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause(_msgSender());
    }

    /// @notice Batalkan signature yang belum dipakai (mis. kreditur menarik tanda tangan sebelum aktivasi).
    function cancelNonce(uint256 nonce) external {
        address caller = _msgSender();
        _useNonce(caller, nonce);
        emit NonceCancelled(caller, nonce);
    }

    // =====================================================================
    //                                VIEWS
    // =====================================================================

    function getNote(bytes32 noteId) external view returns (NoteView memory v) {
        Record storage r = _get(noteId);
        v = NoteView({
            noteId: noteId,
            version: r.version,
            creditor: r.creditor,
            debtor: r.debtor,
            docHash: r.docHash,
            scheduleHash: r.scheduleHash,
            principal: r.principal,
            totalOwed: r.totalOwed,
            lateFee: r.lateFee,
            paid: r.paid,
            dueDate: r.dueDate,
            disbursement: r.disbursement,
            status: _statusOf(r),
            fullyPaid: r.fullyPaid
        });
    }

    /// @notice Status saat ini; OVERDUE dihitung otomatis dari jatuh tempo (tidak butuh keeper).
    function statusOf(bytes32 noteId) external view returns (Status) {
        return _statusOf(_records[noteId]);
    }

    /// @notice Total yang wajib dibayar saat ini (termasuk denda jika sudah lewat jatuh tempo).
    function requiredAmount(bytes32 noteId) external view returns (uint256) {
        return _required(_get(noteId));
    }

    /// @notice Sisa utang saat ini (0 jika sudah lunas).
    function remaining(bytes32 noteId) external view returns (uint256) {
        Record storage r = _get(noteId);
        if (r.fullyPaid) return 0;
        uint256 required = _required(r);
        return required > r.paid ? required - r.paid : 0;
    }

    /// @notice Integrity checker: bandingkan hash hasil hitung ulang dari database dengan hash on-chain.
    function verifyHash(bytes32 noteId, bytes32 recalculatedDocHash) external view returns (bool) {
        Record storage r = _records[noteId];
        return r.status != Status.NONE && r.docHash == recalculatedDocHash;
    }

    /// @notice Struct hash Note (sebelum domain). Dipakai sebagai kunci escrow dan referensi di receipt.
    function noteHash(Note calldata n) external pure returns (bytes32) {
        return _noteHash(n);
    }

    // =====================================================================
    //                              INTERNALS
    // =====================================================================

    /// @dev Struct hash EIP-712. Dipecah dua bagian agar tidak "stack too deep" (14 field, semua tipe statis).
    function _noteHash(Note calldata n) private pure returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    abi.encode(NOTE_TYPEHASH, n.noteId, n.version, n.creditor, n.debtor, n.docHash, n.scheduleHash),
                    abi.encode(n.principal, n.totalOwed, n.lateFee, n.dueDate, n.disbursement, n.deadline),
                    abi.encode(n.creditorNonce, n.debtorNonce)
                )
            );
    }

    function _amendmentHash(Amendment calldata a) private pure returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    abi.encode(AMENDMENT_TYPEHASH, a.noteId, a.newVersion, a.newDocHash, a.newScheduleHash),
                    abi.encode(a.newTotalOwed, a.newLateFee, a.newDueDate, a.deadline, a.creditorNonce, a.debtorNonce)
                )
            );
    }

    function _get(bytes32 noteId) private view returns (Record storage r) {
        r = _records[noteId];
        if (r.status == Status.NONE) revert NoteNotFound();
    }

    function _statusOf(Record storage r) private view returns (Status s) {
        s = r.status;
        if (s == Status.ACTIVE && block.timestamp > r.dueDate) return Status.OVERDUE;
    }

    /// @dev Total wajib bayar sekarang: totalOwed (+ denda flat sekali jika lewat jatuh tempo).
    function _required(Record storage r) private view returns (uint256) {
        return r.totalOwed + (block.timestamp > r.dueDate ? r.lateFee : 0);
    }

    function _setStatus(bytes32 noteId, Record storage r, Status to, address actor) private {
        Status from = r.status;
        r.status = to;
        emit StatusChanged(noteId, from, to, actor);
    }

    /// @dev Validasi field Note untuk piutang baru dan kembalikan struct hash-nya.
    function _validateNewNote(Note calldata n) private view returns (bytes32) {
        if (n.deadline < block.timestamp) revert SignatureExpired();
        if (n.noteId == bytes32(0) || n.docHash == bytes32(0) || n.version == 0) revert InvalidAmount();
        if (n.creditor == address(0) || n.debtor == address(0) || n.creditor == n.debtor) revert InvalidParties();
        if (n.principal == 0 || n.totalOwed < n.principal) revert InvalidAmount();
        if (n.dueDate <= block.timestamp) revert InvalidDueDate();
        if (_records[n.noteId].status != Status.NONE) revert NoteAlreadyExists();
        if (noteIdOfDocHash[n.docHash] != bytes32(0)) revert DocHashAlreadyUsed();
        return _noteHash(n);
    }

    function _verifyAgreement(
        Note calldata n,
        bytes32 noteHash_,
        bytes calldata sigCreditor,
        bytes calldata sigDebtor
    ) private {
        bytes32 digest = _hashTypedDataV4(noteHash_);
        _verify(n.creditor, digest, sigCreditor);
        _verify(n.debtor, digest, sigDebtor);
        _useNonce(n.creditor, n.creditorNonce);
        _useNonce(n.debtor, n.debtorNonce);
    }

    function _verify(address signer, bytes32 digest, bytes memory signature) private view {
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert InvalidSignature(signer);
    }

    function _useNonce(address signer, uint256 nonce) private {
        if (nonceUsed[signer][nonce]) revert NonceAlreadyUsed(signer, nonce);
        nonceUsed[signer][nonce] = true;
    }

    /// @dev Simpan piutang, kunci hash dokumen, mint token ke kreditur, status ACTIVE.
    function _open(Note calldata n, bytes32 noteHash_) private {
        Record storage r = _records[n.noteId];
        r.creditor = n.creditor;
        r.debtor = n.debtor;
        r.dueDate = n.dueDate;
        r.version = n.version;
        r.disbursement = Disbursement(n.disbursement);
        r.docHash = n.docHash;
        r.scheduleHash = n.scheduleHash;
        r.principal = n.principal;
        r.totalOwed = n.totalOwed;
        r.lateFee = n.lateFee;
        noteIdOfDocHash[n.docHash] = n.noteId;

        _setStatus(n.noteId, r, Status.ACTIVE, _msgSender());
        debtNote.mint(n.creditor, uint256(n.noteId));

        emit NoteActivated(
            n.noteId,
            n.creditor,
            n.debtor,
            noteHash_,
            n.docHash,
            n.principal,
            n.totalOwed,
            n.dueDate,
            Disbursement(n.disbursement)
        );
    }

    /// @dev SATU pintu pembukuan untuk pembayaran on-chain dan off-chain.
    function _recordPayment(
        bytes32 noteId,
        Record storage r,
        uint256 amount,
        uint32 installmentIndex,
        bool onchain,
        bytes32 proofHash,
        address actor
    ) private {
        if (r.fullyPaid) revert AlreadyFullyPaid();
        if (amount == 0) revert InvalidAmount();
        uint256 required = _required(r);
        uint256 left = required > r.paid ? required - r.paid : 0;
        if (amount > left) revert Overpayment(left);

        r.paid += amount;
        emit PaymentRecorded(noteId, amount, r.paid, left - amount, onchain, installmentIndex, proofHash);

        if (r.paid >= required) {
            // Dikunci saat pembayaran terjadi: denda yang baru berlaku setelah ini tidak berlaku surut.
            r.fullyPaid = true;
            if (r.status == Status.ACTIVE) _settle(noteId, r, actor);
        }
    }

    /// @dev PAID + burn token. Dipanggil hanya saat status ACTIVE dan fullyPaid.
    function _settle(bytes32 noteId, Record storage r, address actor) private {
        _setStatus(noteId, r, Status.PAID, actor);
        debtNote.burn(uint256(noteId));
        emit NoteSettled(noteId, r.paid);
    }

    function _permit(address owner_, uint256 value, Permit calldata p) private {
        if (p.deadline == 0) return;
        // try/catch: permit bisa di-front-run (nonce dikonsumsi pihak lain); selama allowance cukup, transfer tetap jalan.
        try IERC20Permit(stablecoin).permit(owner_, address(this), value, p.deadline, p.v, p.r, p.s) {} catch {}
    }

    /// @dev Tarik token dan pastikan penerima benar-benar menerima `amount` (menolak token fee-on-transfer).
    function _pull(address from, address to, uint256 amount) private {
        uint256 beforeBal = IERC20Minimal(stablecoin).balanceOf(to);
        stablecoin.safeTransferFrom(from, to, amount);
        uint256 afterBal = IERC20Minimal(stablecoin).balanceOf(to);
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert UnexpectedTransferAmount();
    }
}
