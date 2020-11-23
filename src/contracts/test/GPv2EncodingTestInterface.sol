// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../libraries/GPv2Encoding.sol";

contract GPv2EncodingTestInterface {
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
        uint256 tradeCount,
        bytes calldata encodedTrades
    )
        external
        view
        returns (
            GPv2Encoding.Trade[] memory trades,
            uint256 mem,
            uint256 gas_
        )
    {
        // solhint-disable no-inline-assembly

        uint256 stride = GPv2Encoding.TRADE_STRIDE;
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        trades = new GPv2Encoding.Trade[](tradeCount);

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding a trade to compute memory usage growth per
        // call to `decodeTrade`. Additionally, write 0 past the free memory
        // pointer so the size of `trades` does not affect the gas measurement.
        assembly {
            mem := mload(0x40)
            mstore(mem, 0)
        }
        gas_ = gasleft();

        uint256 start;
        bytes calldata encodedTrade;
        for (uint256 i = 0; i < tradeCount; i++) {
            start = i * stride;
            if (i == tradeCount - 1) {
                // NOTE: Last trade uses all remaining bytes. This allows the
                // `decodeTrade` method to be tested with short and long trade
                // bytes as well.
                encodedTrade = encodedTrades[start:];
            } else {
                encodedTrade = encodedTrades[start:][:stride];
            }

            GPv2Encoding.decodeTrade(
                domainSeparator,
                tokens,
                encodedTrade,
                trades[i]
            );
        }

        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();

        // solhint-enable
    }
}
