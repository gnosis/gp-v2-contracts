// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../GPv2UniswapRouter.sol";

contract GPv2UniswapRouterTestInterface is GPv2UniswapRouter {
    constructor(GPv2Settlement settlement_, IUniswapV2Factory factory_)
        GPv2UniswapRouter(settlement_, factory_)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    function pairFor(
        IUniswapV2Factory factory_,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal view override returns (IUniswapV2Pair pair) {
        // NOTE: We setup the mock in such a way that if `address(0)` is
        // returned, then the Uniswap pair `CREATE2` address is computed so it
        // can be tested. However, setting up the mock to return different
        // pairs for certain token addresses allows us to do a full unit test
        // with mocked Uniswap pairs.
        pair = IUniswapV2Pair(
            factory_.getPair(address(tokenA), address(tokenB))
        );
        if (address(pair) == address(0)) {
            pair = UniswapV2Library.pairFor(factory_, tokenA, tokenB);
        }
    }

    function transferInteractionTest(
        IERC20[] calldata path,
        uint256[] memory amounts
    ) external view returns (GPv2Interaction.Data memory transfer) {
        transferInteraction(path, amounts, transfer);
    }

    function swapInteractionTest(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut,
        address to
    ) external view returns (GPv2Interaction.Data memory swap) {
        swapInteraction(tokenIn, tokenOut, amountOut, to, swap);
    }
}
