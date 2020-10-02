pragma experimental ABIEncoderV2;
pragma solidity ^0.6.12;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "../PreAMMBatcher.sol";

contract PreAMMBatcherTestInterface is PreAMMBatcher {
    // solhint-disable-next-line no-empty-blocks
    constructor(IUniswapV2Factory _factory) public PreAMMBatcher(_factory) {}

    function isSortedByLimitPriceTest(
        Order[] memory orders,
        Direction direction
    ) public pure returns (bool) {
        return super.isSortedByLimitPrice(orders, direction);
    }

    function orderChecksTest(
        Order[] memory sellOrderToken0,
        Order[] memory sellOrderToken1
    ) public pure {
        super.orderChecks(sellOrderToken0, sellOrderToken1);
    }

    function removeLastElementTest(Order[] memory orders)
        public
        pure
        returns (Order[] memory)
    {
        return super.removeLastElement(orders);
    }

    function inverseTest(Fraction memory f)
        public
        pure
        returns (Fraction memory)
    {
        return super.inverse(f);
    }
}
