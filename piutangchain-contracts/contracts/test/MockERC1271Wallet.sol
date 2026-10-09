// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "../libraries/ECDSA.sol";

/// @dev Smart wallet palsu untuk menguji ERC-1271. HANYA UNTUK TEST.
contract MockERC1271Wallet {
    address public immutable signerOwner;

    constructor(address signerOwner_) {
        signerOwner = signerOwner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.tryRecover(hash, signature) == signerOwner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
