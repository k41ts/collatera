// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Target forwarder yang menelan kegagalan inner call (seperti permit di dalam try/catch). HANYA UNTUK TEST.
///      Jika relayer memberi gas terlalu sedikit, inner call kehabisan gas tapi panggilan luar tetap "sukses".
contract MockGasBurner {
    event Done(bool innerOk);

    function burn() external {
        while (true) {}
    }

    function run() external {
        bool innerOk;
        try this.burn{gas: 200_000}() {
            innerOk = true;
        } catch {}
        emit Done(innerOk);
    }
}
