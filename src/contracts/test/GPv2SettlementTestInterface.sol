// SPDX-license-identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(IUniswapV2Factory uniswapFactory_)
        public
        GPv2Settlement(uniswapFactory_)
    {}

    function uniswapTradeTest(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) public {
        super.uniswapTrade(tokenIn, tokenOut, amountIn, amountOut);
    }
}
