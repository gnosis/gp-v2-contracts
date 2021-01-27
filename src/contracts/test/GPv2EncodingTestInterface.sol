// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Encoding.sol";

contract GPv2EncodingTestInterface {
    using GPv2Encoding for bytes;

    bytes32 public constant DOMAIN_SEPARATOR =
        keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name)"),
                keccak256("test")
            )
        );

    function orderTypeHashTest() external pure returns (bytes32) {
        return (GPv2Encoding.ORDER_TYPE_HASH);
    }

    function decodeTradesTest(
        IERC20[] calldata tokens,
        GPv2Encoding.TradeData[] calldata encodedTrades
    )
        external
        view
        returns (
            GPv2Encoding.Trade[] memory trades,
            uint256 mem,
            uint256 gas_
        )
    {
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        trades = new GPv2Encoding.Trade[](encodedTrades.length);
        uint256 i;
        for (i = 0; i < encodedTrades.length; i++) {
            trades[i].orderUid = new bytes(56);
        }

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding a trade to compute memory usage growth per
        // call to `decodeTrade`. Additionally, write 0 past the free memory
        // pointer so the size of `trades` does not affect the gas measurement.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
            mstore(mem, 0)
        }
        gas_ = gasleft();

        for (i = 0; i < encodedTrades.length; i++) {
            GPv2Encoding.decodeTrade(
                encodedTrades[i],
                domainSeparator,
                tokens,
                trades[i]
            );
        }

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();
    }

    function decodeInteractionsTest(
        bytes calldata encodedInteractions,
        uint256 expectedInteractionCount
    ) external pure returns (GPv2Encoding.Interaction[] memory interactions) {
        interactions = new GPv2Encoding.Interaction[](expectedInteractionCount);

        uint256 interactionCount = 0;
        bytes calldata remainingInteractions = encodedInteractions;
        while (remainingInteractions.length != 0) {
            remainingInteractions = remainingInteractions.decodeInteraction(
                interactions[interactionCount]
            );
            interactionCount += 1;
        }

        // Note: expectedInteractionCount is only used to preallocate the memory
        // needed to store all interactions in advance. It is not needed in the
        // the settlement contract since an interaction does not need to be
        // stored in memory after its execution.
        require(
            interactionCount == expectedInteractionCount,
            "bad interaction count"
        );
    }

    function extractOrderUidParamsTest(bytes calldata orderUid)
        external
        pure
        returns (
            bytes32 orderDigest,
            address owner,
            uint32 validTo
        )
    {
        return orderUid.extractOrderUidParams();
    }

    function decodeOrderUidsTest(bytes calldata encodedOrderUids)
        external
        pure
        returns (bytes[] memory orderUids)
    {
        orderUids = new bytes[](encodedOrderUids.orderUidCount());
        for (uint256 i = 0; i < orderUids.length; i++) {
            orderUids[i] = encodedOrderUids.orderUidAtIndex(i);
        }
    }
}
