// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../GPv2Settlement.sol";
import "../libraries/GPv2Interaction.sol";
import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Trade.sol";

interface IUniswapV2Factory {}

interface IUniswapV2Pair {
    function getReserves()
        external
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        );

    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external;
}

contract UniswapV2SettlementWrapper {
    using GPv2Trade for uint256;
    using SafeMath for uint256;

    GPv2Settlement private immutable settlement;

    IUniswapV2Factory private immutable factory;

    constructor(GPv2Settlement settlement_, IUniswapV2Factory factory_) {
        settlement = settlement_;
        factory = factory_;
    }

    function settleSwap(IERC20[] calldata path, GPv2Trade.Data calldata trade)
        external
    {
        uint256 tokenCount = path.length;
        require(tokenCount > 1, "invalid path");
        require(
            trade.sellTokenIndex == 0 && trade.buyTokenIndex == tokenCount - 1,
            "invalid trade for path"
        );

        uint256[] memory amounts;
        {
            (bytes32 kind, , ) = trade.flags.extractFlags();
            amounts = kind == GPv2Order.SELL
                ? getAmountsOut(trade.sellAmount, path)
                : getAmountsIn(trade.buyAmount, path);
        }

        uint256[] memory prices = new uint256[](tokenCount);
        prices[0] = amounts[tokenCount - 1];
        prices[tokenCount - 1] = amounts[0];

        GPv2Interaction.Data[][3] memory interactions;
        {
            GPv2Interaction.Data[] memory intra =
                new GPv2Interaction.Data[](tokenCount);
            {
                GPv2Interaction.Data memory transfer = intra[0];
                transfer.target = address(path[0]);
                transfer.callData = abi.encodeWithSelector(
                    IERC20.transfer.selector,
                    pairFor(path[0], path[1]),
                    amounts[0]
                );
            }
            for (uint256 i = 1; i < tokenCount; i++) {
                (IERC20 input, IERC20 output) = (path[i - 1], path[i]);
                address to =
                    i < tokenCount - 1
                        ? address(pairFor(output, path[i + 1]))
                        : address(settlement);
                (IERC20 token0, ) = sortTokens(input, output);
                (uint256 amount0Out, uint256 amount1Out) =
                    input == token0
                        ? (uint256(0), amounts[i])
                        : (amounts[i], uint256(0));
                GPv2Interaction.Data memory swap = intra[i];
                swap.target = address(pairFor(input, output));
                swap.callData = abi.encodeWithSelector(
                    IUniswapV2Pair.swap.selector,
                    amount0Out,
                    amount1Out,
                    to,
                    bytes("")
                );
            }
            interactions[1] = intra;
        }

        settlement.settle(path, prices, tradeAsArray(trade), interactions);
    }

    function tradeAsArray(GPv2Trade.Data calldata trade)
        private
        pure
        returns (GPv2Trade.Data[] memory trades)
    {
        trades = new GPv2Trade.Data[](1);
        trades[0] = trade;
    }

    // Shamelessly copied (with minor modifications) from:
    // <https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol>
    //
    // This is done to avoid having to implement this with an old compiler
    // without all the features we need for the settlement wrapping code.

    function sortTokens(IERC20 tokenA, IERC20 tokenB)
        internal
        pure
        returns (IERC20 token0, IERC20 token1)
    {
        require(tokenA != tokenB, "UniswapV2Library: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(
            address(token0) != address(0),
            "UniswapV2Library: ZERO_ADDRESS"
        );
    }

    function pairFor(IERC20 tokenA, IERC20 tokenB)
        internal
        view
        returns (IUniswapV2Pair pair)
    {
        (IERC20 token0, IERC20 token1) = sortTokens(tokenA, tokenB);
        pair = IUniswapV2Pair(
            address(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encodePacked(token0, token1)),
                            hex"96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f" // init code hash
                        )
                    )
                )
            )
        );
    }

    function getReserves(IERC20 tokenA, IERC20 tokenB)
        internal
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        (IERC20 token0, ) = sortTokens(tokenA, tokenB);
        (uint256 reserve0, uint256 reserve1, ) =
            pairFor(tokenA, tokenB).getReserves();
        (reserveA, reserveB) = tokenA == token0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT");
        require(
            reserveIn > 0 && reserveOut > 0,
            "UniswapV2Library: INSUFFICIENT_LIQUIDITY"
        );
        uint256 amountInWithFee = amountIn.mul(997);
        uint256 numerator = amountInWithFee.mul(reserveOut);
        uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        require(amountOut > 0, "UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT");
        require(
            reserveIn > 0 && reserveOut > 0,
            "UniswapV2Library: INSUFFICIENT_LIQUIDITY"
        );
        uint256 numerator = reserveIn.mul(amountOut).mul(1000);
        uint256 denominator = reserveOut.sub(amountOut).mul(997);
        amountIn = (numerator / denominator).add(1);
    }

    function getAmountsOut(uint256 amountIn, IERC20[] calldata path)
        internal
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "UniswapV2Library: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) =
                getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(uint256 amountOut, IERC20[] calldata path)
        internal
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "UniswapV2Library: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) =
                getReserves(path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}
