pragma experimental ABIEncoderV2;
pragma solidity ^0.6.2;

contract PreAMMBatcher {
    uint256 public x_uniswap = 10000;
    uint256 public y_uniswap = 20000;

    struct Order {
        uint256 buyAmount;
        uint256 sellAmount;
        address owner;
    }

    struct Fraction {
        uint256 numerator;
        uint256 denominator;
    }

    constructor() public {}

    /*
     * calculates the price by settling a fraction of the orders by against each other and then the rest against the uniswap pool
     * assumes all ordres are fully covered
     * @buyOrders, orders that are willing to sell a good A for a good B sorted by their price
     * @sellOrders, orders that are willing to sell a good B for a good A sorted by their price
     */
    function calculatePrice(Order[] memory buyOrders, Order[] memory sellOrders)
        public
        returns (Fraction memory price)
    {
        Fraction memory lowerPriceBound = Fraction(
            buyOrders[0].buyAmount,
            buyOrders[0].sellAmount
        );
        Fraction memory higherPriceBound = Fraction(
            sellOrders[0].sellAmount,
            sellOrders[0].buyAmount
        );
        //... further logic to come
    }
}
