pragma experimental ABIEncoderV2;
pragma solidity ^0.6.12;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./libraries/Math.sol";

contract PreAMMBatcher {
    using SafeMath for uint256;

    bytes32 public constant DOMAIN_SEPARATOR = keccak256("preBatcher-V1");
    uint256 public constant FEE_FACTOR = 333; // Charged fee is (FEE_FACTOR-1)/FEE_FACTOR

    uint256 private constant ENTRIES_IN_ORDER = 8;
    uint256 private constant ENTRIES_IN_SIGNATURE = 3;
    uint256 private constant OFFCHAIN_ORDER_STRIDE = 32 *
        (ENTRIES_IN_ORDER + ENTRIES_IN_SIGNATURE);

    IUniswapV2Factory private uniswapFactory;

    mapping(address => uint8) public nonces; // Probably a nonce per tokenpair would be better

    struct Order {
        uint256 sellAmount;
        uint256 buyAmount;
        address sellToken;
        address buyToken;
        address owner;
        uint32 validFrom;
        uint32 validUntil;
        uint8 nonce;
    }

    struct Fraction {
        uint256 numerator;
        uint256 denominator;
    }

    event BatchSettlement(
        address token0,
        address token1,
        uint256 sellAmountToken0,
        uint256 sellAmountToken1
    );

    constructor(IUniswapV2Factory _uniswapFactory) public {
        uniswapFactory = _uniswapFactory;
    }

    function batchTrade(bytes calldata order0bytes, bytes calldata order1bytes)
        public
        returns (Fraction memory clearingPrice)
    {
        Order[] memory sellOrdersToken0 = decodeOrders(order0bytes);
        Order[] memory sellOrdersToken1 = decodeOrders(order1bytes);
        for (uint256 i = 0; i < sellOrdersToken0.length; i++) {
            sellOrdersToken0[i] = reduceOrder(sellOrdersToken0[i]);
        }
        for (uint256 i = 0; i < sellOrdersToken1.length; i++) {
            sellOrdersToken1[i] = reduceOrder(sellOrdersToken1[i]);
        }
        orderChecks(sellOrdersToken0, sellOrdersToken1);
        receiveTradeAmounts(sellOrdersToken0);
        receiveTradeAmounts(sellOrdersToken1);
        IUniswapV2Pair uniswapPool = IUniswapV2Pair(
            uniswapFactory.getPair(
                sellOrdersToken0[0].sellToken,
                sellOrdersToken1[0].sellToken
            )
        );
        uint256 unmatchedAmount = 0;
        (
            unmatchedAmount,
            clearingPrice,
            sellOrdersToken0,
            sellOrdersToken1
        ) = calculateSettlementPrice(
            sellOrdersToken0,
            sellOrdersToken1,
            uniswapPool
        );
        settleUnmatchedAmountsToUniswap(
            unmatchedAmount,
            clearingPrice,
            sellOrdersToken0[0],
            uniswapPool
        );
        markSettledOrders(sellOrdersToken0);
        markSettledOrders(sellOrdersToken1);
        payOutTradeProceedings(sellOrdersToken0, clearingPrice);
        payOutTradeProceedings(sellOrdersToken1, inverse(clearingPrice));
        emit BatchSettlement(
            sellOrdersToken0[0].sellToken,
            sellOrdersToken1[0].sellToken,
            clearingPrice.denominator,
            clearingPrice.numerator
        );
    }

    function inverse(Fraction memory f)
        internal
        pure
        returns (Fraction memory)
    {
        return Fraction(f.denominator, f.numerator);
    }

    function orderIsCurrentlyValid(Order memory order)
        private
        view
        returns (bool)
    {
        // solhint-disable not-rely-on-time
        return
            (order.validUntil >= block.timestamp) &&
            (order.validFrom <= block.timestamp);
        // solhint-enable not-rely-on-time
    }

    function orderChecks(
        Order[] memory sellOrderToken0,
        Order[] memory sellOrderToken1
    ) internal view {
        address buyToken = sellOrderToken0[0].buyToken;
        address sellToken = sellOrderToken0[0].sellToken;
        for (uint256 i = 0; i < sellOrderToken0.length; i++) {
            require(
                sellOrderToken0[i].sellToken == sellToken,
                "invalid token0 order sell token"
            );
            require(
                sellOrderToken0[i].buyToken == buyToken,
                "invalid token0 order buy token"
            );
            require(
                orderIsCurrentlyValid(sellOrderToken0[i]),
                "token0 order not currently valid"
            );
        }
        for (uint256 i = 0; i < sellOrderToken1.length; i++) {
            require(
                sellOrderToken1[i].sellToken == buyToken,
                "invalid token1 order sell token"
            );
            require(
                sellOrderToken1[i].buyToken == sellToken,
                "invalid token1 order buy token"
            );
            require(
                orderIsCurrentlyValid(sellOrderToken1[i]),
                "token1 order not currently valid"
            );
        }
    }

    function reduceOrder(Order memory order)
        public
        view
        returns (Order memory)
    {
        IERC20 sellToken = IERC20(order.sellToken);
        uint256 newSellAmount = Math.min(
            sellToken.allowance(order.owner, address(this)),
            sellToken.balanceOf(order.owner)
        );
        order.buyAmount = (newSellAmount.mul(order.buyAmount)).div(
            order.sellAmount
        );
        order.sellAmount = newSellAmount;
        return order;
    }

    function decodeSingleOrder(bytes calldata orderBytes)
        internal
        pure
        returns (Order memory orders)
    {
        (
            uint256 sellAmount,
            uint256 buyAmount,
            address sellToken,
            address buyToken,
            address owner,
            uint32 validFrom,
            uint32 validUntil,
            uint8 nonce,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
            orderBytes,
            (
                uint256,
                uint256,
                address,
                address,
                address,
                uint32,
                uint32,
                uint8,
                uint8,
                bytes32,
                bytes32
            )
        );
        bytes32 digest = keccak256(
            abi.encode(
                DOMAIN_SEPARATOR,
                sellAmount,
                buyAmount,
                sellToken,
                buyToken,
                owner,
                validFrom,
                validUntil,
                nonce
            )
        );
        address recoveredAddress = ecrecover(digest, v, r, s);
        require(
            recoveredAddress != address(0) && recoveredAddress == owner,
            "invalid_signature"
        );
        return
            Order({
                sellAmount: sellAmount,
                buyAmount: buyAmount,
                buyToken: buyToken,
                sellToken: sellToken,
                owner: owner,
                validFrom: validFrom,
                validUntil: validUntil,
                nonce: nonce
            });
    }

    function decodeOrders(bytes calldata orderBytes)
        internal
        pure
        returns (Order[] memory orders)
    {
        require(
            orderBytes.length % OFFCHAIN_ORDER_STRIDE == 0,
            "malformed encoded orders"
        );
        orders = new Order[](orderBytes.length / OFFCHAIN_ORDER_STRIDE);
        uint256 count = 0;
        while (orderBytes.length > 0) {
            bytes calldata singleOrder = orderBytes[:OFFCHAIN_ORDER_STRIDE];
            orderBytes = orderBytes[OFFCHAIN_ORDER_STRIDE:];
            orders[count] = decodeSingleOrder(singleOrder);
            count = count + 1;
        }
    }

    function markSettledOrders(Order[] memory orders) public {
        for (uint256 i = 0; i < orders.length; i++) {
            require(
                nonces[orders[i].owner] < orders[i].nonce,
                "nonce already used"
            );
        }
        for (uint256 i = 0; i < orders.length; i++) {
            nonces[orders[i].owner] = orders[i].nonce;
        }
    }

    function calculateSettlementPrice(
        Order[] memory sellOrderToken0,
        Order[] memory sellOrderToken1,
        IUniswapV2Pair uniswapPool
    )
        public
        returns (
            uint256,
            Fraction memory,
            Order[] memory,
            Order[] memory
        )
    {
        uint256 totalSellAmountToken0 = 0;
        for (uint256 i = 0; i < sellOrderToken0.length; i++) {
            totalSellAmountToken0 = totalSellAmountToken0.add(
                sellOrderToken0[i].sellAmount
            );
        }
        uint256 totalSellAmountToken1 = 0;
        for (uint256 i = 0; i < sellOrderToken1.length; i++) {
            totalSellAmountToken1 = totalSellAmountToken1.add(
                sellOrderToken1[i].sellAmount
            );
        }

        if (totalSellAmountToken0 == 0 || totalSellAmountToken1 == 0) {
            revert("no solution found");
        }

        Order memory highestSellOrderToken1 = sellOrderToken1[sellOrderToken1
            .length - 1];
        if (
            totalSellAmountToken0.mul(highestSellOrderToken1.sellAmount) <
            totalSellAmountToken1.mul(highestSellOrderToken1.buyAmount)
        ) {
            // switch order pairs
            return
                calculateSettlementPrice(
                    sellOrderToken1,
                    sellOrderToken0,
                    uniswapPool
                );
        }

        (uint112 reserve0, uint112 reserve1, ) = uniswapPool.getReserves();
        // reserves actually need to be switched, if tokens are switched

        Fraction memory clearingPrice = Fraction({
            numerator: (totalSellAmountToken0.add(reserve0)),
            denominator: (totalSellAmountToken1.add(reserve1))
        });
        {

                Order memory highestSellOrderToken0
             = sellOrderToken0[sellOrderToken0.length - 1];

            if (
                highestSellOrderToken0.sellAmount.mul(
                    clearingPrice.denominator
                ) <
                (highestSellOrderToken0.buyAmount.mul(clearingPrice.numerator))
            ) {
                // take violated order with highest bid out
                return
                    calculateSettlementPrice(
                        removeLastElement(sellOrderToken0),
                        sellOrderToken1,
                        uniswapPool
                    );
            } else if (
                (clearingPrice.numerator.mul(
                    highestSellOrderToken1.sellAmount
                ) <
                    clearingPrice.denominator.mul(
                        highestSellOrderToken1.buyAmount
                    ))
            ) {
                // take violated order with highest bid out
                return
                    calculateSettlementPrice(
                        sellOrderToken0,
                        removeLastElement(sellOrderToken1),
                        uniswapPool
                    );
            }
        }
        uint256 unmatchedAmountToken0 = totalSellAmountToken0.sub(
            totalSellAmountToken1.mul(clearingPrice.numerator).div(
                clearingPrice.denominator
            )
        );
        return (
            unmatchedAmountToken0,
            clearingPrice,
            sellOrderToken0,
            sellOrderToken1
        );
    }

    function settleUnmatchedAmountsToUniswap(
        uint256 unsettledDirectAmount,
        Fraction memory clearingPrice,
        Order memory sellOrderToken0,
        IUniswapV2Pair uniswapPool
    ) internal {
        if (unsettledDirectAmount > 0) {
            require(
                IERC20(sellOrderToken0.sellToken).transfer(
                    address(uniswapPool),
                    unsettledDirectAmount
                ),
                "transfer to uniswap failed"
            );
            if (sellOrderToken0.sellToken == uniswapPool.token0()) {
                uniswapPool.swap(
                    0,
                    unsettledDirectAmount
                        .mul(clearingPrice.denominator)
                        .mul(997)
                        .div(clearingPrice.numerator)
                        .div(1000),
                    address(this),
                    ""
                );
            } else {
                uniswapPool.swap(
                    unsettledDirectAmount
                        .mul(clearingPrice.denominator)
                        .mul(997)
                        .div(clearingPrice.numerator)
                        .div(1000),
                    0,
                    address(this),
                    ""
                );
            }
        }
    }

    function receiveTradeAmounts(Order[] memory orders) internal {
        for (uint256 i = 0; i < orders.length; i++) {
            require(
                IERC20(orders[i].sellToken).transferFrom(
                    orders[i].owner,
                    address(this),
                    orders[i].sellAmount
                ),
                "order transfer failed"
            );
        }
    }

    function payOutTradeProceedings(
        Order[] memory orders,
        Fraction memory price
    ) internal {
        for (uint256 i = 0; i < orders.length; i++) {
            require(
                IERC20(orders[i].buyToken).transfer(
                    orders[i].owner,
                    orders[i]
                        .sellAmount
                        .mul(price.denominator)
                        .div(price.numerator)
                        .mul(FEE_FACTOR - 1)
                        .div(FEE_FACTOR)
                ),
                "final token transfer failed"
            );
        }
    }

    function removeLastElement(Order[] memory orders)
        internal
        pure
        returns (Order[] memory)
    {
        require(orders.length > 0, "Can't remove from empty list");
        // delete orders[orders.length - 1];
        // return orders;
        Order[] memory newOrders = new Order[](orders.length - 1);
        for (uint256 i = 0; i < orders.length - 1; i++) {
            newOrders[i].sellAmount = orders[i].sellAmount;
            newOrders[i].buyAmount = orders[i].buyAmount;
            newOrders[i].sellToken = orders[i].sellToken;
            newOrders[i].buyToken = orders[i].buyToken;
            newOrders[i].owner = orders[i].owner;
            newOrders[i].nonce = orders[i].nonce;
        }
        return newOrders;
    }

    enum Direction {Ascending, Descending}

    function isSortedByLimitPrice(Order[] memory orders, Direction direction)
        internal
        pure
        returns (bool)
    {
        if (orders.length < 2) {
            // All order sets with less than 2 elements are tautologically sorted.
            return true;
        }
        for (uint256 i = 0; i < orders.length - 1; i++) {
            Order memory orderA = orders[i];
            Order memory orderB = orders[i + 1];
            if (direction == Direction.Ascending) {
                if (
                    orderA.buyAmount.mul(orderB.sellAmount) >
                    orderB.buyAmount.mul(orderA.sellAmount)
                ) {
                    return false;
                }
            } else {
                if (
                    orderA.buyAmount.mul(orderB.sellAmount) <
                    orderB.buyAmount.mul(orderA.sellAmount)
                ) {
                    return false;
                }
            }
        }
        return true;
    }
}
