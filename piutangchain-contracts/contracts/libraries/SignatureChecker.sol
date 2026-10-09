// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "./ECDSA.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";

/// @notice Verifikasi signature EOA (ECDSA) dan smart account (ERC-1271).
library SignatureChecker {
    bytes4 private constant MAGIC = 0x1626ba7e;

    function isValidSignatureNow(address signer, bytes32 hash, bytes memory signature) internal view returns (bool) {
        if (signer == address(0)) return false;
        // ECDSA lebih dulu: EOA yang memakai delegasi EIP-7702 punya code tapi tetap menandatangani dengan ECDSA.
        if (ECDSA.tryRecover(hash, signature) == signer) return true;
        if (signer.code.length == 0) return false;
        (bool ok, bytes memory ret) = signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (hash, signature)));
        return ok && ret.length >= 32 && abi.decode(ret, (bytes32)) == bytes32(MAGIC);
    }
}
