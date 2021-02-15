// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

contract BalanceOf {
    mapping(address => uint256) public balanceOf;

    function setBalanceOf(address account, uint256 newBalance) external {
        balanceOf[account] = newBalance;
    }
}
