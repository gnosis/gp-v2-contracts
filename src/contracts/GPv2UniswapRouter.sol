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
contract GPv2UniswapRouter {
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
            UniswapV2Library.pairFor(
                address(factory),
                address(path[0]),
                address(path[1])
            ),
            amounts[0]
        );
    }
}
