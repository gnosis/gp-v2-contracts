// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

interface NonStandardERC20 {
    /// @dev Non-standard ERC20 `transferFrom` that does not return a bool
    /// indicating success.
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external;
}
