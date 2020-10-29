// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    // solhint-disable no-empty-blocks

    constructor(IUniswapV2Factory uniswapFactory_)
        public
        GPv2Settlement(uniswapFactory_)
    {}

    // solhint-enable

    function setNonce(IUniswapV2Pair pair, uint256 nonce) external {
        nonces[pair] = nonce;
    }

    function fetchIncrementNonceTest(IUniswapV2Pair pair)
        external
        returns (uint256)
    {
        return fetchIncrementNonce(pair);
    }

    struct Order {
        uint112 sellAmount;
        uint112 buyAmount;
        uint32 validTo;
        uint112 tip;
        uint8 flags;
        uint112 executedAmount;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function decodeOrderTest(bytes calldata encodedOrder)
        external
        pure
        returns (Order memory result)
    {
        (
            uint112 sellAmount,
            uint112 buyAmount,
            uint32 validTo,
            uint112 tip,
            uint8 flags,
            uint112 executedAmount,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = decodeOrder(encodedOrder);

        result.sellAmount = sellAmount;
        result.buyAmount = buyAmount;
        result.validTo = validTo;
        result.tip = tip;
        result.flags = flags;
        result.executedAmount = executedAmount;
        result.v = v;
        result.r = r;
        result.s = s;
    }

    function decodeOrderMemoryTest(bytes calldata encodedOrder)
        external
        pure
        returns (uint256 mem)
    {
        // solhint-disable no-inline-assembly

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding an order to compute memory usage growth per
        // call to `decodeOrder`.
        assembly {
            mem := mload(0x40)
        }

        decodeOrder(encodedOrder);

        assembly {
            mem := sub(mload(0x40), mem)
        }

        // solhint-enable
    }
}
