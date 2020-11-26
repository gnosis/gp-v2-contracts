// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../GPv2AllowanceManager.sol";
import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(GPv2Authentication authenticator_)
        GPv2Settlement(authenticator_)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    function domainSeparatorTest() external view returns (bytes32) {
        return domainSeparator;
    }

    function allowanceManagerTest() external view returns (address) {
        return address(allowanceManager);
    }

    function processTradesTest(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata encodedTrades
    )
        external
        view
        returns (
            GPv2AllowanceManager.Transfer[] memory inTransfers,
            GPv2AllowanceManager.Transfer[] memory outTransfers
        )
    {
        (inTransfers, outTransfers) = processTrades(
            tokens,
            clearingPrices,
            encodedTrades
        );
    }

    function processTradeMemoryTest() external pure returns (uint256 mem) {
        GPv2Encoding.Trade memory trade;
        GPv2AllowanceManager.Transfer memory inTransfer;
        GPv2AllowanceManager.Transfer memory outTransfer;

        // NOTE: Solidity stores the free memory pointer at address 0x40. Read
        // it before and after calling `processOrder` to ensure that there are
        // no memory allocations.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
        }

        processTrade(trade, 1, 1, inTransfer, outTransfer);

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
    }
}
