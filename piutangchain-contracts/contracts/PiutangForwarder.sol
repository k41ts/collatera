// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "./utils/EIP712.sol";
import {SignatureChecker} from "./libraries/SignatureChecker.sol";

/// @title PiutangForwarder
/// @notice Forwarder ERC-2771 untuk transaksi tanpa gas: pengguna menandatangani ForwardRequest (EIP-712),
///         relayer mengirimnya dan membayar gas. Mendukung EOA dan smart account (ERC-1271).
///         Dibaca oleh kontrak target lewat ERC2771Context (alamat pengirim asli ditempel di akhir calldata).
contract PiutangForwarder is EIP712 {
    struct ForwardRequest {
        address from;
        address to;
        uint256 gas;
        uint256 nonce;
        uint48 deadline;
        bytes data;
    }

    event Forwarded(address indexed from, address indexed to, uint256 nonce);
    event ManagerSet(address indexed manager);

    error InvalidSignature();
    error InvalidNonce(uint256 expected);
    error RequestExpired(uint48 deadline);
    error TargetNotContract(address target);
    error CallFailed(bytes returnData);
    error TargetNotAllowed(address target);
    error NotDeployer();
    error ManagerAlreadySet();

    bytes32 private constant REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");

    /// @dev Batas data return/revert target yang disalin ke memori forwarder (mencegah return bomb ke relayer).
    uint256 public constant MAX_RETURN_BYTES = 4096;

    mapping(address => uint256) public nonces;

    /// @dev Satu-satunya target yang boleh dipanggil. DebtManager butuh alamat forwarder di constructor-nya, jadi
    ///      alamatnya diset sekali lewat `setManager` oleh deployer setelah DebtManager dibuat.
    address public manager;
    address public immutable deployer;

    constructor() EIP712("PiutangForwarder", "1") {
        deployer = msg.sender;
    }

    /// @notice Set DebtManager satu kali (hanya deployer). Tidak bisa diubah lagi.
    function setManager(address manager_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (manager != address(0)) revert ManagerAlreadySet();
        if (manager_.code.length == 0) revert TargetNotContract(manager_);
        manager = manager_;
        emit ManagerSet(manager_);
    }

    /// @notice Cek cepat untuk relayer sebelum mengirim (view).
    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        if (req.nonce != nonces[req.from]) return false;
        if (req.deadline < block.timestamp) return false;
        bytes32 structHash = keccak256(
            abi.encode(REQUEST_TYPEHASH, req.from, req.to, req.gas, req.nonce, req.deadline, keccak256(req.data))
        );
        return SignatureChecker.isValidSignatureNow(req.from, _hashTypedDataV4(structHash), signature);
    }

    /// @dev Jika panggilan target revert, seluruh transaksi revert (nonce tidak terpakai) dan data revert diteruskan.
    function execute(ForwardRequest calldata req, bytes calldata signature) external returns (bytes memory) {
        if (req.nonce != nonces[req.from]) revert InvalidNonce(nonces[req.from]);
        if (req.deadline < block.timestamp) revert RequestExpired(req.deadline);
        if (req.to != manager) revert TargetNotAllowed(req.to);
        if (req.to.code.length == 0) revert TargetNotContract(req.to);
        if (!verify(req, signature)) revert InvalidSignature();

        nonces[req.from] = req.nonce + 1;

        // Panggilan low-level: data return disalin maksimal MAX_RETURN_BYTES (bukan seluruhnya seperti `call` biasa).
        // Data revert yang lebih kecil dari batas diteruskan utuh; yang lebih besar dipotong.
        bytes memory payload = abi.encodePacked(req.data, req.from);
        address target = req.to;
        uint256 callGas = req.gas;
        uint256 maxRet = MAX_RETURN_BYTES;
        bool ok;
        bytes memory ret;
        assembly {
            ok := call(callGas, target, 0, add(payload, 0x20), mload(payload), 0, 0)
            let size := returndatasize()
            if gt(size, maxRet) {
                size := maxRet
            }
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 0x20), 0, size)
            mstore(0x40, add(add(ret, 0x20), and(add(size, 31), not(31))))
        }
        // EIP-150: jika relayer mengirim gas terlalu sedikit, target hanya menerima 63/64 sisa gas dan bisa
        // berjalan dengan gas < req.gas (mis. permit di dalam try/catch sengaja dibuat gagal). Batalkan semuanya.
        if (gasleft() <= req.gas / 63) {
            assembly {
                invalid()
            }
        }
        if (!ok) {
            if (ret.length == 0) revert CallFailed(ret);
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit Forwarded(req.from, req.to, req.nonce);
        return ret;
    }
}
