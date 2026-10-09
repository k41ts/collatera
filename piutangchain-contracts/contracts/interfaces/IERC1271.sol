// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC1271 {
    /// @return magicValue 0x1626ba7e jika signature valid
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}
