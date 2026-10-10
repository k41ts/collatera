// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "../libraries/ECDSA.sol";

/// @dev Smart wallet ERC-1271 yang bisa berperilaku jahat. HANYA UNTUK TEST.
contract MockHostileWallet {
    enum Mode {
        VALID, //        valid jika signature dari owner
        GARBAGE, //      return data pendek (4 byte)
        WRONG_MAGIC, //  32 byte tapi bukan magic
        REVERT, //       revert
        BURN_GAS, //     loop tanpa henti
        REENTER, //      mencoba memanggil target dari dalam isValidSignature; valid hanya jika panggilan itu gagal
        BOMB //          return data 500 KB
    }

    address public immutable owner;
    Mode public mode;
    address public reenterTarget;
    bytes public reenterData;

    constructor(address owner_) {
        owner = owner_;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    /// @dev Wallet bertindak sebagai pemanggil (mis. approve token, refundEscrow). Hanya owner.
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "bukan owner");
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "call gagal");
        return ret;
    }

    // non-view agar mode REENTER bisa mencoba menulis state; pemanggil memakai staticcall sehingga penulisan selalu gagal
    function isValidSignature(bytes32 hash, bytes calldata signature) external returns (bytes4) {
        Mode m = mode;
        if (m == Mode.GARBAGE) {
            assembly {
                mstore(0, 0xdeadbeef00000000000000000000000000000000000000000000000000000000)
                return(0, 4)
            }
        }
        if (m == Mode.WRONG_MAGIC) return bytes4(0xffffffff);
        if (m == Mode.REVERT) revert("jahat");
        if (m == Mode.BURN_GAS) {
            while (true) {}
        }
        if (m == Mode.BOMB) {
            assembly {
                return(0, 500000)
            }
        }
        if (m == Mode.REENTER) {
            // Dalam staticcall, panggilan yang menulis state PASTI gagal. Wallet hanya menyatakan valid jika gagal,
            // jadi "tanda tangan diterima" membuktikan reentrancy tidak berhasil mengubah apa pun.
            (bool ok, ) = reenterTarget.call(reenterData);
            return ok ? bytes4(0xffffffff) : bytes4(0x1626ba7e);
        }
        return ECDSA.tryRecover(hash, signature) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
