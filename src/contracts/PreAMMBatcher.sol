pragma experimental ABIEncoderV2;
pragma solidity ^0.6.2;
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract PreAMMBatcher {
    using SafeMath for uint256;
    IUniswapV2Factory uniswapFactory;

    bytes32 public constant DOMAIN_SEPARATOR = keccak256("preBatcher-V1");
    uint256 public constant feeFactor = 333; // Charged fee is (feeFactor-1)/feeFactor
    mapping(address => uint8) public nonces; // Probably a nonce per tokenpair would be better

    event Log(uint256 b);
    event Log2(bytes b);

    struct Order {
        uint256 sellAmount;
        uint256 buyAmount;
        address sellToken;
        address buyToken;
        address owner;
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
        Order[] memory sellOrdersToken0 = parseOrderBytes(order0bytes);
        Order[] memory sellOrdersToken1 = parseOrderBytes(order1bytes);
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
        uint256 unmatchedAmountToken0 = 0;
        (unmatchedAmountToken0, clearingPrice) = calculateSettlementPrice(
            sellOrdersToken0,
            sellOrdersToken1,
            uniswapPool
        );
        settleUnmatchedAmountsToUniswap(
            unmatchedAmountToken0,
            clearingPrice,
            sellOrdersToken0[0],
            uniswapPool
        );
        payOutTradeProceedings(sellOrdersToken0, clearingPrice);
        payOutTradeProceedings(sellOrdersToken1, inverse(clearingPrice));
        emit BatchSettlement(
            sellOrdersToken0[0].sellToken,
            sellOrdersToken1[0].sellToken,
            clearingPrice.denominator,
            clearingPrice.numerator
        );
    }

    function inverse(Fraction memory f) public pure returns (Fraction memory) {
        return Fraction(f.denominator, f.numerator);
    }

    function orderChecks(
        Order[] memory sellOrderToken0,
        Order[] memory sellOrderToken1
    ) public pure {
        address buyToken = sellOrderToken0[0].buyToken;
        address sellToken = sellOrderToken0[0].sellToken;
        for (uint256 i = 0; i < sellOrderToken0.length; i++) {
            require(
                sellOrderToken0[i].sellToken == sellToken,
                "sellOrderToken0 are not compatible in sellToken"
            );
            require(
                sellOrderToken0[i].buyToken == buyToken,
                "sellOrderToken0 are not compatible in buyToken"
            );
        }
        for (uint256 i = 0; i < sellOrderToken1.length; i++) {
            require(
                sellOrderToken1[i].sellToken == buyToken,
                "sellOrderToken1 are not compatible in sellToken"
            );
            require(
                sellOrderToken1[i].buyToken == sellToken,
                "sellOrderToken1 are not compatible in sellToken"
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

    function parseOrderBytes(bytes calldata orderBytes)
        public
        returns (Order[] memory orders)
    {
        orders = new Order[](orderBytes.length / 190);
        uint256 count = 0;
        while (orderBytes.length > 189) {
            bytes calldata singleOrder = orderBytes[:288];
            orderBytes = orderBytes[288:];
            (
                uint256 sellAmount,
                uint256 buyAmount,
                address sellToken,
                address buyToken,
                address owner,
                uint8 nonce,
                uint8 v,
                bytes32 r,
                bytes32 s
            ) = abi.decode(
                singleOrder,
                (
                    uint256,
                    uint256,
                    address,
                    address,
                    address,
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
                    nonce
                )
            );
            address recoveredAddress = ecrecover(digest, v, r, s);
            require(
                recoveredAddress != address(0) && recoveredAddress == owner,
                "invalid_signature"
            );
            require(nonces[owner] < nonce, "nonce already used");
            nonces[owner] = nonce;
            orders[count] = Order({
                sellAmount: sellAmount,
                buyAmount: buyAmount,
                buyToken: buyToken,
                sellToken: sellToken,
                owner: owner
            });
            count = count.add(1);
        }
    }

    function calculateSettlementPrice(
        Order[] memory sellOrderToken0,
        Order[] memory sellOrderToken1,
        IUniswapV2Pair uniswapPool
    )
        public
        returns (uint256 unmatchedAmountToken0, Fraction memory clearingPrice)
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
        (uint112 reserve0, uint112 reserve1, ) = uniswapPool.getReserves();
        uint256 uniswapK = uint256(reserve0).mul(reserve1);
        // if deltaUniswapToken0 will be > 0
        // if(sellOrderToken1.sellAmount * serve0 / reserve1 > sellToken2Order.sellAmount)
        uint256 p = uniswapK.div(
            uint256(2).mul(uint256(reserve1).add(totalSellAmountToken1))
        );
        uint256 newReserve0 = p.add(
            Math.sqrt(
                p.mul(p).add(
                    uniswapK.mul(totalSellAmountToken0).div(
                        uint256(reserve1).add(totalSellAmountToken1)
                    )
                )
            )
        );
        uint256 newReserve1 = uniswapK.div(newReserve0);
        clearingPrice = Fraction({
            numerator: newReserve0,
            denominator: newReserve1
        });
        Order memory highestSellOrderToken0 = sellOrderToken0[sellOrderToken0
            .length - 1];

        Order memory highestSellOrderToken1 = sellOrderToken1[sellOrderToken1
            .length - 1];
        require(
            clearingPrice.numerator.mul(highestSellOrderToken0.sellAmount) >=
                clearingPrice.denominator.mul(highestSellOrderToken0.buyAmount),
            "sellOrderToken0 price violations"
        );
        require(
            clearingPrice.numerator.mul(highestSellOrderToken1.sellAmount) >
                clearingPrice.denominator.mul(highestSellOrderToken1.buyAmount),
            "sellOrderToken1 price violations"
        );
        unmatchedAmountToken0 = totalSellAmountToken0.sub(
            totalSellAmountToken1.mul(clearingPrice.numerator).div(
                clearingPrice.denominator
            )
        );
    }

    function settleUnmatchedAmountsToUniswap(
        uint256 unsettledDirectAmountToken0,
        Fraction memory clearingPrice,
        Order memory sellOrderToken0,
        IUniswapV2Pair uniswapPool
    ) internal {
        require(
            IERC20(sellOrderToken0.sellToken).transfer(
                address(uniswapPool),
                unsettledDirectAmountToken0
            ),
            "transfer to uniswap failed"
        );
        uniswapPool.swap(
            0,
            unsettledDirectAmountToken0
                .mul(clearingPrice.denominator)
                .mul(997)
                .div(clearingPrice.numerator)
                .div(1000),
            address(this),
            ""
        );
    }

    function receiveTradeAmounts(Order[] memory orders) internal {
        for (uint256 i = 0; i < orders.length; i++) {
            require(
                IERC20(orders[i].sellToken).transferFrom(
                    orders[i].owner,
                    address(this),
                    orders[i].sellAmount
                ),
                "unsuccessful transferFrom for order"
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
                        .mul(feeFactor - 1)
                        .div(feeFactor)
                ),
                "final token transfer failed"
            );
        }
    }
}
