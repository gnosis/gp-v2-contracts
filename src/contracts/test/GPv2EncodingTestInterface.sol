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

    function tradeCountTest(bytes calldata encodedTrades)
        external
        pure
        returns (uint256 count, bytes calldata encodedTradesWithoutLength)
    {
        (count, encodedTradesWithoutLength) = encodedTrades.decodeTradeCount();
    }

    function decodeTradesTest(
        IERC20[] calldata tokens,
        bytes calldata encodedTrades
    )
        external
        view
        returns (
            uint256 tradeCount,
            GPv2Encoding.Trade[] memory trades,
            uint256 mem,
            uint256 gas_
        )
    {
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        bytes calldata remainingEncodedTrades;
        (tradeCount, remainingEncodedTrades) = encodedTrades.decodeTradeCount();

        trades = new GPv2Encoding.Trade[](tradeCount);
        uint256 i;
        for (i = 0; i < tradeCount; i++) {
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

        i = 0;
        while (remainingEncodedTrades.length != 0) {
            remainingEncodedTrades = remainingEncodedTrades.decodeTrade(
                domainSeparator,
                tokens,
                trades[i]
            );
            i++;
        }

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();
    }
}
