// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

abstract contract ReentrancyGuard {
    error ReentrantCall();

    uint256 private _guard = 1;

    modifier nonReentrant() {
        if (_guard == 2) revert ReentrantCall();
        _guard = 2;
        _;
        _guard = 1;
    }
}
