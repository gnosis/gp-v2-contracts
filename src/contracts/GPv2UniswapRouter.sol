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

    /// @dev Execute a GPv2 settlement with a single trade against a Uniswap
    /// path.
    ///
    /// This method performs no input validation, instead it performs on-chain
    /// computation of the swap amounts in order to encode interactions and set
    /// clearing prices such as the trader receives positive slippage. Verifying
    /// the signature and validity of the trade (limit prices, expiry, etc.) is
    /// done by the settlement contract.
    ///
    /// @param path The Uniswap route for trading.
    /// @param trade The GPv2 trade to execute.
    /// @param limitAmount The input or output amount limit for the swap,
    /// enabling solvers to specify tighter Uniswap slippage than the order.
    function settleSwap(
        IERC20[] calldata path,
        GPv2Trade.Data calldata trade,
        uint256 limitAmount
    ) external {
        uint256 tokenCount = path.length;
        require(tokenCount > 1, "GPv2: invalid path");
        require(
            trade.sellTokenIndex == 0 && trade.buyTokenIndex == tokenCount - 1,
            "GPv2: invalid trade for path"
        );

        uint256[] memory amounts;
        {
            (bytes32 kind, , ) = trade.flags.extractFlags();
            if (kind == GPv2Order.SELL) {
                amounts = getAmountsOut(factory, trade.sellAmount, path);
                require(
                    limitAmount <= amounts[tokenCount - 1],
                    "GPv2: swap out too low"
                );
            } else {
                amounts = getAmountsIn(factory, trade.buyAmount, path);
                require(limitAmount >= amounts[0], "GPv2: swap in too high");
            }
        }

        GPv2Interaction.Data[][3] memory interactions;
        {
            GPv2Interaction.Data[] memory intra =
                new GPv2Interaction.Data[](tokenCount);
            interactions[1] = intra;

            transferInteraction(path, amounts, intra[0]);
            for (uint256 i = 1; i < tokenCount; i++) {
                (IERC20 tokenIn, IERC20 tokenOut) = (path[i - 1], path[i]);
                address to =
                    i < tokenCount - 1
                        ? address(pairFor(factory, tokenOut, path[i + 1]))
                        : address(settlement);
                swapInteraction(tokenIn, tokenOut, amounts[i], to, intra[i]);
            }
        }

        uint256[] memory prices = new uint256[](tokenCount);
        prices[0] = amounts[tokenCount - 1];
        prices[tokenCount - 1] = amounts[0];

        GPv2Trade.Data[] memory trades = new GPv2Trade.Data[](1);
        trades[0] = trade;

        settlement.settle(path, prices, trades, interactions);
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
            pairFor(factory, path[0], path[1]),
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
        (IERC20 token0, ) = sortTokens(tokenIn, tokenOut);
        (uint256 amount0Out, uint256 amount1Out) =
            tokenIn == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
        swap.target = address(pairFor(factory, tokenIn, tokenOut));
        swap.callData = abi.encodeWithSelector(
            IUniswapV2Pair.swap.selector,
            amount0Out,
            amount1Out,
            to,
            bytes("")
        );
    }
}
