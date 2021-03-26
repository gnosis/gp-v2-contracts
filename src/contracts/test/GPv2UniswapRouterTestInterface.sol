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

    function transferInteractionTest(
        IERC20[] calldata path,
        uint256[] memory amounts
    ) external view returns (GPv2Interaction.Data memory transfer) {
        transferInteraction(path, amounts, transfer);
    }
}
