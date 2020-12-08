// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../libraries/GPv2TradeExecution.sol";

contract GPv2TradeExecutionTestInterface {
    using GPv2TradeExecution for GPv2TradeExecution.Data;

    function transferSellAmountToRecipientTest(
        GPv2TradeExecution.Data calldata trade,
        address recipient
    ) external {
        GPv2TradeExecution.transferSellAmountToRecipient(trade, recipient);
    }

    function transferBuyAmountToOwnerTest(
        GPv2TradeExecution.Data calldata trade
    ) external {
        trade.transferBuyAmountToOwner();
    }
}
