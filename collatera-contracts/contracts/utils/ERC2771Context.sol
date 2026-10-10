// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Meta-transaction (ERC-2771): forwarder tepercaya menambahkan alamat pengirim asli di akhir calldata.
abstract contract ERC2771Context {
    address private immutable _trustedForwarder;

    constructor(address forwarder) {
        _trustedForwarder = forwarder;
    }

    function trustedForwarder() public view returns (address) {
        return _trustedForwarder;
    }

    function isTrustedForwarder(address forwarder) public view returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function _msgSender() internal view virtual returns (address sender) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
