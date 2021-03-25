// SPDX-License-Identifier: GPL-3.0-or-later

// Vendored from Uniswap core contracts with minor modifications:
// - Added appropriate SPDX license comment
// - Modified Solidity version
// - Removed unused method
// - Formatted code
// - Shortened revert messages
// - Converted to an abstract contract with virtual `pairFor` for testing
// - Use interface types instead of opaque `address`es
// - Use `calldata` instead of `memory` array types
// <https://github.com/Uniswap/uniswap-v2-core/blob/v1.0.1/contracts/interfaces/IUniswapV2Factory.sol>

pragma solidity ^0.7.6;

import "../interfaces/IERC20.sol";
import "../libraries/SafeMath.sol";
import "./IUniswapV2Factory.sol";
import "./IUniswapV2Pair.sol";

abstract contract UniswapV2Library {
    using SafeMath for uint256;

    // returns sorted token addresses, used to handle return values from pairs sorted in this order
    function sortTokens(IERC20 tokenA, IERC20 tokenB)
        internal
        pure
        returns (IERC20 token0, IERC20 token1)
    {
        require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(address(token0) != address(0), "UniswapV2: ZERO_ADDRESS");
    }

    // calculates the CREATE2 address for a pair without making any external calls
    function pairFor(
        IUniswapV2Factory factory,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal view virtual returns (IUniswapV2Pair pair) {
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

    // fetches and sorts the reserves for a pair
    function getReserves(
        IUniswapV2Factory factory,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal view returns (uint256 reserveA, uint256 reserveB) {
        (IERC20 token0, ) = sortTokens(tokenA, tokenB);
        (uint256 reserve0, uint256 reserve1, ) =
            pairFor(factory, tokenA, tokenB).getReserves();
        (reserveA, reserveB) = tokenA == token0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "UniswapV2: INSUFFICIENT_IN_AMT");
        require(
            reserveIn > 0 && reserveOut > 0,
            "UniswapV2: INSUFFICIENT_LQDTY"
        );
        uint256 amountInWithFee = amountIn.mul(997);
        uint256 numerator = amountInWithFee.mul(reserveOut);
        uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }

    // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        require(amountOut > 0, "UniswapV2: INSUFFICIENT_OUT_AMT");
        require(
            reserveIn > 0 && reserveOut > 0,
            "UniswapV2: INSUFFICIENT_LQDTY"
        );
        uint256 numerator = reserveIn.mul(amountOut).mul(1000);
        uint256 denominator = reserveOut.sub(amountOut).mul(997);
        amountIn = (numerator / denominator).add(1);
    }

    // performs chained getAmountOut calculations on any number of pairs
    function getAmountsOut(
        IUniswapV2Factory factory,
        uint256 amountIn,
        IERC20[] calldata path
    ) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, "UniswapV2: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) =
                getReserves(factory, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    // performs chained getAmountIn calculations on any number of pairs
    function getAmountsIn(
        IUniswapV2Factory factory,
        uint256 amountOut,
        IERC20[] calldata path
    ) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, "UniswapV2: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) =
                getReserves(factory, path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}
