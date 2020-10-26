// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.6.12;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    // solhint-disable-next-line no-empty-blocks
    constructor(IUniswapV2Factory uniswapFactory_)
        public
        GPv2Settlement(uniswapFactory_)
    {}

    function verifyClearingPriceTest(
        IUniswapV2Pair pair,
        int112 d0,
        int112 d1,
        uint112 clearingPrice0,
        uint112 clearingPrice1
    ) external view {
        verifyClearingPrice(pair, d0, d1, clearingPrice0, clearingPrice1);
    }
}
