// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

abstract contract Pausable {
    event Paused(address account);
    event Unpaused(address account);

    error EnforcedPause();
    error ExpectedPause();

    bool private _paused;

    modifier whenNotPaused() {
        if (_paused) revert EnforcedPause();
        _;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function _pause(address account) internal {
        if (_paused) revert EnforcedPause();
        _paused = true;
        emit Paused(account);
    }

    function _unpause(address account) internal {
        if (!_paused) revert ExpectedPause();
        _paused = false;
        emit Unpaused(account);
    }
}
