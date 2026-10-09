// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ERC-20 transfer yang aman terhadap token tanpa return value dan token yang return false.
library TransferHelper {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer(address,uint256)
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0x23b872dd, from, to, amount)); // transferFrom(address,address,uint256)
    }

    function _call(address token, bytes memory data) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) revert TransferFailed();
        if (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
