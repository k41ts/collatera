// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Recover signer ECDSA dengan penolakan signature malleable (s tinggi) dan v tidak valid.
library ECDSA {
    // secp256k1n / 2
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @return signer address(0) jika signature tidak valid
    function tryRecover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        if (uint256(s) > HALF_N) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }

    /// @dev signature 65 byte: r (32) || s (32) || v (1)
    function tryRecover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        return tryRecover(hash, v, r, s);
    }
}
