// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Token "nakal" untuk menguji ketahanan DebtManager terhadap stablecoin yang tidak standar. HANYA UNTUK TEST.
contract MockHostileToken {
    enum Mode {
        NORMAL,
        FEE_ON_TRANSFER,
        RETURN_FALSE,
        NO_RETURN_VALUE,
        REENTER
    }

    Mode public mode;
    address public reenterTarget;
    bytes public reenterData;
    bool public reenterSucceeded;
    bytes public reenterReturn;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setMode(Mode m) external {
        mode = m;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        Mode m = mode;
        if (m == Mode.RETURN_FALSE) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += m == Mode.FEE_ON_TRANSFER ? amount - amount / 100 : amount;
        if (m == Mode.REENTER) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            reenterSucceeded = ok;
            reenterReturn = ret;
        }
        if (m == Mode.NO_RETURN_VALUE) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}
