// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "./interfaces/IERC20.sol";
import "./libraries/GPv2TradeExecution.sol";
import "./mixins/GPv2OnlyCreator.sol";

/// @title Gnosis Protocol v2 Allowance Manager Contract
/// @author Gnosis Developers
contract GPv2AllowanceManager is GPv2OnlyCreator {
    using GPv2TradeExecution for GPv2TradeExecution.Data;

    /// @dev Transfers all sell amounts for the executed trades from their
    /// owners to the caller.
    ///
    /// This function reverts if:
    /// - The caller is not the creator of the allowance manager
    /// - Any ERC20 transfer fails
    ///
    /// @param trades The executed trades whose sell amounts need to be
    /// transferred in.
    function transferIn(GPv2TradeExecution.Data[] calldata trades)
        external
        onlyCreator
    {
        for (uint256 i = 0; i < trades.length; i++) {
            GPv2TradeExecution.transferSellAmountToRecipient(
                trades[i],
                msg.sender
            );
        }
    }
}
