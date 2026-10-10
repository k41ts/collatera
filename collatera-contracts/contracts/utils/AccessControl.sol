// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Role-based access control minimal. DEFAULT_ADMIN_ROLE mengelola semua role.
abstract contract AccessControl {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);
    error AccessControlBadConfirmation();

    mapping(bytes32 role => mapping(address account => bool)) private _roles;

    /// @dev Di-override oleh ERC2771Context agar pengirim asli (bukan forwarder) yang dicek.
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    modifier onlyRole(bytes32 role) {
        _checkRole(role, _msgSender());
        _;
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) external {
        if (callerConfirmation != _msgSender()) revert AccessControlBadConfirmation();
        _revokeRole(role, callerConfirmation);
    }

    function _checkRole(bytes32 role, address account) internal view {
        if (!_roles[role][account]) revert AccessControlUnauthorizedAccount(account, role);
    }

    function _grantRole(bytes32 role, address account) internal {
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, _msgSender());
        }
    }

    function _revokeRole(bytes32 role, address account) internal {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, _msgSender());
        }
    }
}
