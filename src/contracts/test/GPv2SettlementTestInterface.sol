// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.6.12;

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
}
