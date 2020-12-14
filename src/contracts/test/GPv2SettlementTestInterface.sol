// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../GPv2Settlement.sol";
import "../libraries/GPv2Encoding.sol";
import "../libraries/GPv2TradeExecution.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(GPv2Authentication authenticator_)
        GPv2Settlement(authenticator_)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    function computeTradeExecutionsTest(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata encodedTrades
    ) external returns (GPv2TradeExecution.Data[] memory executedTrades) {
        executedTrades = computeTradeExecutions(
            tokens,
            clearingPrices,
            encodedTrades
        );
    }

    function computeTradeExecutionMemoryTest() external returns (uint256 mem) {
        GPv2Encoding.Trade memory trade;
        GPv2TradeExecution.Data memory executedTrade;

        // NOTE: Solidity stores the free memory pointer at address 0x40. Read
        // it before and after calling `processOrder` to ensure that there are
        // no memory allocations.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
        }

        // solhint-disable-next-line not-rely-on-time
        trade.order.validTo = uint32(block.timestamp);
        computeTradeExecution(trade, 1, 1, executedTrade);

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
    }

    function transferOutTest(GPv2TradeExecution.Data[] memory trades) external {
        transferOut(trades);
    }

    function executeInteractionsTest(bytes calldata encodedInteractions)
        external
    {
        executeInteractions(encodedInteractions);
    }

    function executeInteractionTest(GPv2Encoding.Interaction memory interaction)
        external
    {
        executeInteraction(interaction);
    }
}
