// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library Strings {
    bytes16 private constant HEX = "0123456789abcdef";

    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function toHexString(bytes32 value) internal pure returns (string memory) {
        return _hex(uint256(value), 32);
    }

    function toHexString(address value) internal pure returns (string memory) {
        return _hex(uint256(uint160(value)), 20);
    }

    function _hex(uint256 value, uint256 byteLength) private pure returns (string memory) {
        bytes memory buffer = new bytes(2 + byteLength * 2);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 2 + byteLength * 2; i > 2; ) {
            unchecked {
                i--;
                buffer[i] = HEX[value & 0xf];
                value >>= 4;
            }
        }
        return string(buffer);
    }
}
