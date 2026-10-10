// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "./utils/EIP712.sol";
import {ECDSA} from "./libraries/ECDSA.sol";

/// @title MockIDRX
/// @notice Stablecoin IDR TIRUAN untuk testnet. ERC-20 + ERC-2612 (permit) + faucet. JANGAN dipakai di mainnet.
/// @dev Satuan terkecil mengikuti `decimals`. Semua nominal di DebtManager memakai satuan terkecil ini.
contract MockIDRX is EIP712 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FaucetAmountUpdated(uint256 amount);

    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidRecipient();
    error PermitExpired();
    error PermitInvalidSigner();
    error NotOwner();
    error FaucetCooldown(uint256 availableAt);
    error FaucetDisabled();

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    string public constant name = "Mock IDRX";
    string public constant symbol = "mIDRX";
    uint8 public immutable decimals;
    address public immutable owner;

    uint256 public totalSupply;
    uint256 public faucetAmount;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) public lastFaucetAt;

    constructor(uint8 decimals_, address owner_, uint256 faucetAmount_) EIP712("Mock IDRX", "1") {
        decimals = decimals_;
        owner = owner_;
        faucetAmount = faucetAmount_;
    }

    // ---------------------------------------------------------------- ERC-20

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    // --------------------------------------------------------------- ERC-2612

    function permit(
        address owner_,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert PermitExpired();
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, nonces[owner_]++, deadline));
        address signer = ECDSA.tryRecover(_hashTypedDataV4(structHash), v, r, s);
        if (signer == address(0) || signer != owner_) revert PermitInvalidSigner();
        _approve(owner_, spender, value);
    }

    // ----------------------------------------------------------- Mint/faucet

    /// @notice Mint bebas oleh owner (operator testnet).
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _mint(to, amount);
    }

    /// @notice Faucet publik: `faucetAmount` per alamat per 24 jam.
    function faucet() external {
        uint256 amount = faucetAmount;
        if (amount == 0) revert FaucetDisabled();
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, amount);
    }

    function setFaucetAmount(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        faucetAmount = amount;
        emit FaucetAmountUpdated(amount);
    }

    // --------------------------------------------------------------- internal

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _approve(address owner_, address spender, uint256 amount) private {
        allowance[owner_][spender] = amount;
        emit Approval(owner_, spender, amount);
    }
}
