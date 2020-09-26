pragma experimental ABIEncoderV2;
pragma solidity ^0.6.2;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "../PreAMMBatcher.sol";

contract PreAMMBatcherTestInterface is PreAMMBatcher {
    constructor(IUniswapV2Factory _factory) public PreAMMBatcher(_factory) {}

    function isSortedByLimitPriceTest(
        Order[] memory orders,
        Direction direction
    ) public pure returns (bool) {
        return super.isSortedByLimitPrice(orders, direction);
    }
}
