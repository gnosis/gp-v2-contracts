// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "./GPv2Settlement.sol";
import "./interfaces/IERC20.sol";
import "./libraries/GPv2Interaction.sol";
import "./libraries/GPv2Order.sol";
import "./libraries/GPv2Trade.sol";
import "./libraries/SafeMath.sol";
import "./uniswap/IUniswapV2Pair.sol";
import "./uniswap/IUniswapV2Factory.sol";
import "./uniswap/UniswapV2Library.sol";

/// @title Gnosis Protocol v2 Uniswap Router
/// @author Gnosis Developers
contract GPv2UniswapRouter is UniswapV2Library {
    using GPv2Trade for uint256;
    using SafeMath for uint256;

    /// @dev The GPv2 settlement contract this router wraps.
    GPv2Settlement public immutable settlement;

    /// @dev The Uniswap factory used for getting pairs.
    IUniswapV2Factory public immutable factory;

    constructor(GPv2Settlement settlement_, IUniswapV2Factory factory_) {
        settlement = settlement_;
        factory = factory_;
    }

    /// @dev Encode the transfer interaction used for sending ERC20 tokens to
    /// the first Uniswap pair in a path to kick off the swaps.
    ///
    /// @param path The ERC20 token swap path.
    /// @param amounts The computed token amounts that will be swapped.
    /// @param transfer The interaction to encode the transfer for.
    function transferInteraction(
        IERC20[] calldata path,
        uint256[] memory amounts,
        GPv2Interaction.Data memory transfer
    ) internal view {
        transfer.target = address(path[0]);
        transfer.callData = abi.encodeWithSelector(
            IERC20.transfer.selector,
            pairFor(path[0], path[1]),
            amounts[0]
        );
    }

    /// @dev Encode a Uniswap pair swap interaction.
    ///
    /// @param tokenIn The input token for the swap.
    /// @param tokenOut The output token for the swap.
    /// @param amountOut The desired output amount.
    /// @param to The address to receive the output amount.
    /// @param swap The interaction to encode the swap for.
    function swapInteraction(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut,
        address to,
        GPv2Interaction.Data memory swap
    ) internal view {
        (address token0, ) = sortTokens(address(tokenIn), address(tokenOut));
        (uint256 amount0Out, uint256 amount1Out) =
            address(tokenIn) == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
        swap.target = address(pairFor(tokenIn, tokenOut));
        swap.callData = abi.encodeWithSelector(
            IUniswapV2Pair.swap.selector,
            amount0Out,
            amount1Out,
            to,
            bytes("")
        );
    }

    /// @dev Internal helper function used for calling the `UniswapV2Library`
    /// `pairFor` method with the global `factory` value and cast interfaces to
    /// `address`es.
    function pairFor(IERC20 tokenA, IERC20 tokenB)
        private
        view
        returns (IUniswapV2Pair pair)
    {
        pair = IUniswapV2Pair(
            pairFor(address(factory), address(tokenA), address(tokenB))
        );
    }
}
