// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../GPv2Settlement.sol";
import "../libraries/GPv2Interaction.sol";
import "../libraries/GPv2Trade.sol";
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
        GPv2Trade.Data[] calldata trades
    ) external returns (GPv2TradeExecution.Data[] memory executedTrades) {
        executedTrades = computeTradeExecutions(tokens, clearingPrices, trades);
    }

    function computeTradeExecutionMemoryTest() external returns (uint256 mem) {
        RecoveredOrder memory recoveredOrder;
        GPv2TradeExecution.Data memory executedTrade;

        // NOTE: Solidity stores the free memory pointer at address 0x40. Read
        // it before and after calling `processOrder` to ensure that there are
        // no memory allocations.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
        }

        // solhint-disable-next-line not-rely-on-time
        recoveredOrder.data.validTo = uint32(block.timestamp);
        computeTradeExecution(recoveredOrder, 1, 1, 0, 0, executedTrade);

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
    }

    function transferOutTest(GPv2TradeExecution.Data[] memory trades) external {
        transferOut(trades);
    }

    function executeInteractionsTest(
        GPv2Interaction.Data[] calldata interactions
    ) external {
        executeInteractions(interactions);
    }

    function claimOrderRefundsTest(OrderRefunds calldata orderRefunds)
        external
    {
        claimOrderRefunds(orderRefunds);
    }
}
