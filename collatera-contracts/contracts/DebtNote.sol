// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDebtManager} from "./interfaces/IDebtManager.sol";
import {Strings} from "./libraries/Strings.sol";

/// @title DebtNote
/// @notice Token piutang (ERC-721) NON-TRANSFERABLE. Hanya DebtManager yang boleh mint dan burn.
///         tokenId == uint256(noteId). Mendukung ERC-165, ERC-721, ERC-721 Metadata, dan ERC-5192 (locked).
/// @dev Mint tidak memakai callback onERC721Received (token tidak bisa dipindah, jadi tidak ada risiko token
///      nyangkut) sehingga wallet kontrak tidak bisa menggagalkan aktivasi.
contract DebtNote {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Locked(uint256 tokenId);
    event ManagerSet(address indexed manager);

    error Soulbound();
    error NotManager();
    error NotInitializer();
    error ManagerAlreadySet();
    error InvalidAddress();
    error NonexistentToken(uint256 tokenId);
    error AlreadyMinted(uint256 tokenId);

    string public constant name = "Collatera Debt Note";
    string public constant symbol = "CLDN";

    address public immutable initializer;
    address public manager;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;

    constructor() {
        initializer = msg.sender;
    }

    /// @notice Dipanggil sekali oleh deployer setelah DebtManager dibuat.
    function setManager(address manager_) external {
        if (msg.sender != initializer) revert NotInitializer();
        if (manager != address(0)) revert ManagerAlreadySet();
        if (manager_ == address(0)) revert InvalidAddress();
        manager = manager_;
        emit ManagerSet(manager_);
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager();
        _;
    }

    // ------------------------------------------------------------ mint/burn

    function mint(address to, uint256 tokenId) external onlyManager {
        if (to == address(0)) revert InvalidAddress();
        if (_owners[tokenId] != address(0)) revert AlreadyMinted(tokenId);
        _owners[tokenId] = to;
        unchecked {
            _balances[to] += 1;
        }
        emit Transfer(address(0), to, tokenId);
        emit Locked(tokenId);
    }

    function burn(uint256 tokenId) external onlyManager {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken(tokenId);
        delete _owners[tokenId];
        unchecked {
            _balances[tokenOwner] -= 1;
        }
        emit Transfer(tokenOwner, address(0), tokenId);
    }

    // ----------------------------------------------------------------- views

    function balanceOf(address tokenOwner) external view returns (uint256) {
        if (tokenOwner == address(0)) revert InvalidAddress();
        return _balances[tokenOwner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken(tokenId);
        return tokenOwner;
    }

    /// @dev ERC-5192
    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f || // ERC-721 Metadata
            interfaceId == 0xb45a3c0e; //   ERC-5192
    }

    /// @notice Metadata on-chain: noteId, hash dokumen, nominal pokok, jatuh tempo, kreditur, debitur, status.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        IDebtManager.NoteView memory n = IDebtManager(manager).getNote(bytes32(tokenId));
        string memory head = string.concat(
            'data:application/json;utf8,{"name":"Collatera Debt Note","attributes":[',
            _attr("noteId", Strings.toHexString(n.noteId), true),
            _attr("docHash", Strings.toHexString(n.docHash), true)
        );
        string memory mid = string.concat(
            _attr("principal", Strings.toString(n.principal), false),
            _attr("dueDate", Strings.toString(n.dueDate), false)
        );
        string memory tail = string.concat(
            _attr("creditor", Strings.toHexString(n.creditor), true),
            _attr("debtor", Strings.toHexString(n.debtor), true),
            _attrLast("status", _statusName(n.status))
        );
        return string.concat(head, mid, tail);
    }

    function _attr(string memory key, string memory value, bool quoted) private pure returns (string memory) {
        return
            quoted
                ? string.concat('{"trait_type":"', key, '","value":"', value, '"},')
                : string.concat('{"trait_type":"', key, '","value":', value, "},");
    }

    function _attrLast(string memory key, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', key, '","value":"', value, '"}]}');
    }

    function _statusName(IDebtManager.Status s) private pure returns (string memory) {
        if (s == IDebtManager.Status.ACTIVE) return "ACTIVE";
        if (s == IDebtManager.Status.OVERDUE) return "OVERDUE";
        if (s == IDebtManager.Status.PAID) return "PAID";
        if (s == IDebtManager.Status.DISPUTED) return "DISPUTED";
        if (s == IDebtManager.Status.FROZEN) return "FROZEN";
        return "NONE";
    }

    // --------------------------------------------- transfer & approval: terkunci

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }
}
