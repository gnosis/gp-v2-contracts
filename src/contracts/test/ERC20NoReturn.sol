// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";

contract ERC20NoReturn {
    using SafeMath for uint256;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] = balanceOf[to].add(amount);
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] = balanceOf[msg.sender].sub(amount);
        balanceOf[to] = balanceOf[to].add(amount);
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external {
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(amount);
        balanceOf[from] = balanceOf[from].sub(amount);
        balanceOf[to] = balanceOf[to].add(amount);
    }
}
