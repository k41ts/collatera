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

    error InvalidSignature();
    error InvalidNonce(uint256 expected);
    error RequestExpired(uint48 deadline);
    error TargetNotContract(address target);
    error CallFailed(bytes returnData);

    bytes32 private constant REQUEST_TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");

    mapping(address => uint256) public nonces;

    constructor() EIP712("PiutangForwarder", "1") {}

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
        if (req.to.code.length == 0) revert TargetNotContract(req.to);
        if (!verify(req, signature)) revert InvalidSignature();

        nonces[req.from] = req.nonce + 1;

        (bool ok, bytes memory ret) = req.to.call{gas: req.gas}(abi.encodePacked(req.data, req.from));
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
