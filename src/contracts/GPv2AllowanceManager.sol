// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/// @title Gnosis Protocol v2 Allowance Manager Contract
/// @author Gnosis Developers
contract GPv2AllowanceManager {
    using SafeERC20 for IERC20;

    /// @dev A struct representing transfers to be executed as part of a batch
    /// settlement.
    struct Transfer {
        address owner;
        IERC20 token;
        uint256 amount;
    }

    /// @dev The owner contract of the allowance manager. The owner is set at
    /// creation time and cannot change.
    address private immutable owner;

    constructor() {
        owner = msg.sender;
    }

    /// @dev Modifier that ensures that a function can only be called by the
    /// owner of this contract.
    modifier onlyOwner {
        require(msg.sender == owner, "GPv2: not allowance owner");
        _;
    }

    /// @dev Executes all transfers from the specified accounts into the caller.
    ///
    /// This function reverts if:
    /// - The caller is not the owner of the allowance manager
    /// - Any ERC20 tranfer fails
    function transferIn(Transfer[] calldata transfers) external onlyOwner {
        for (uint256 i = 0; i < transfers.length; i++) {
            transfers[i].token.safeTransferFrom(
                transfers[i].owner,
                msg.sender,
                transfers[i].amount
            );
        }
    }
}
