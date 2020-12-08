// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/// @title Gnosis Protocol v2 Trade Execution
/// @author Gnosis Developers
library GPv2TradeExecution {
    using SafeERC20 for IERC20;

    /// @dev Executed trade data.
    struct Data {
        address owner;
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
    }

    /// @dev Executes the trade's sell amount, transferring it from the trade's
    /// owner to the specified recipient.
    function transferSellAmountToRecipient(
        Data calldata trade,
        address recipient
    ) internal {
        trade.sellToken.safeTransferFrom(
            trade.owner,
            recipient,
            trade.sellAmount
        );
    }

    /// @dev Executes the trade's buy amount, transferring it to the trade's
    /// owner from the caller's address.
    function transferBuyAmountToOwner(Data memory trade) internal {
        trade.buyToken.safeTransfer(trade.owner, trade.buyAmount);
    }
}
