// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/GPv2SafeERC20.sol";
import "./libraries/GPv2TradeExecution.sol";

/// @title Gnosis Protocol v2 Allowance Manager Contract
/// @author Gnosis Developers
contract GPv2AllowanceManager {
    using GPv2SafeERC20 for IERC20;
    using GPv2TradeExecution for GPv2TradeExecution.Data;

    /// @dev A struct for direct transfers when settling a single order.
    struct DirectTransfer {
        address target;
        uint256 amount;
    }

    /// @dev The recipient of all transfers made by the allowance manager. The
    /// recipient is set at creation time and cannot change.
    address private immutable recipient;

    constructor() {
        recipient = msg.sender;
    }

    /// @dev Modifier that ensures that a function can only be called by the
    /// recipient of this contract.
    modifier onlyRecipient {
        require(msg.sender == recipient, "GPv2: not allowance recipient");
        _;
    }

    /// @dev Transfers all sell amounts for the executed trades from their
    /// owners to the caller.
    ///
    /// This function reverts if:
    /// - The caller is not the recipient of the allowance manager
    /// - Any ERC20 transfer fails
    ///
    /// @param trades The executed trades whose sell amounts need to be
    /// transferred in.
    function transferIn(GPv2TradeExecution.Data[] calldata trades)
        external
        onlyRecipient
    {
        for (uint256 i = 0; i < trades.length; i++) {
            GPv2TradeExecution.transferSellAmountToRecipient(
                trades[i],
                msg.sender
            );
        }
    }

    /// @dev Performs direct transfers of user funds to the specified targets
    /// when settling a single order.
    ///
    /// This function reverts if:
    /// - The caller is not the recipient of the allowance manager
    /// - Any ERC20 transfer fails
    ///
    /// @param sellToken The sell token for the order.
    /// @param owner The owner of the order.
    /// @param transfers The direct transfers to perform.
    function transferDirect(
        IERC20 sellToken,
        address owner,
        DirectTransfer[] calldata transfers
    ) external onlyRecipient returns (uint256 totalTransfer) {
        for (uint256 i = 0; i < transfers.length; i++) {
            DirectTransfer calldata transfer = transfers[i];
            sellToken.safeTransferFrom(owner, transfer.target, transfer.amount);
            totalTransfer += transfer.amount;
        }
    }
}
