// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GPv2SafeERC20.sol";

/// @title Gnosis Protocol v2 Trade Execution
/// @author Gnosis Developers
library GPv2TradeExecution {
    using GPv2SafeERC20 for IERC20;

    /// @dev Ether marker address used to indicate an order is buying Ether.
    address internal constant BUY_ETH_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

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
        require(
            address(trade.sellToken) != BUY_ETH_ADDRESS,
            "GPv2: cannot transfer native ETH"
        );
        trade.sellToken.safeTransferFrom(
            trade.owner,
            recipient,
            trade.sellAmount
        );
    }

    /// @dev Executes the trade's buy amount, transferring it to the trade's
    /// owner from the caller's address.
    function transferBuyAmountToOwner(Data memory trade) internal {
        if (address(trade.buyToken) == BUY_ETH_ADDRESS) {
            payable(trade.owner).transfer(trade.buyAmount);
        } else {
            trade.buyToken.safeTransfer(trade.owner, trade.buyAmount);
        }
    }
}
