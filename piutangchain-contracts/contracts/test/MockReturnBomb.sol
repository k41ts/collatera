// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Target forwarder yang mengembalikan (atau me-revert dengan) data sangat besar. HANYA UNTUK TEST.
contract MockReturnBomb {
    uint256 public immutable size;

    constructor(uint256 size_) {
        size = size_;
    }

    fallback() external {
        uint256 n = size;
        // data revert/return berukuran `size`, isi nol
        if (msg.data.length > 0 && msg.data[0] == 0x01) {
            assembly {
                revert(0, n)
            }
        }
        assembly {
            return(0, n)
        }
    }
}
