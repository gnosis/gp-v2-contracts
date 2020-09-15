pragma experimental ABIEncoderV2;
pragma solidity ^0.5.16;
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/libraries/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract PreAMMBatcher {
    using SafeMath for uint256;
    IUniswapV2Factory uniswapFactory;

    bytes32 public constant DOMAIN_SEPARATOR = keccak256("preBatcher-V1");
    mapping(address => uint8) public nonces; // probably a nonce per tokenpair would be better

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

    function preBatchTrade(bytes memory order0bytes, bytes memory order1bytes)
        public
        returns (Fraction memory clearingPrice)
    {
        Order memory sellOrderToken0 = parseOrderBytes(order0bytes);
        Order memory sellOrderToken1 = parseOrderBytes(order1bytes);
        sellOrderToken0 = reduceOrder(sellOrderToken0);
        sellOrderToken1 = reduceOrder(sellOrderToken1);
        require(
            orderChecks(sellOrderToken0, sellOrderToken1),
            "orders-checks are not succesful"
        );
        receiveTradeAmounts(sellOrderToken0, sellOrderToken1);
        IUniswapV2Pair uniswapPool = IUniswapV2Pair(
            uniswapFactory.getPair(
                sellOrderToken0.sellToken,
                sellOrderToken1.sellToken
            )
        );
        clearingPrice = calculateSettlementPrice(
            sellOrderToken0,
            sellOrderToken1,
            uniswapPool
        );
        uint256 unmatchedAmountToken0 = sellOrderToken0.sellAmount.sub(
            sellOrderToken1.sellAmount.mul(clearingPrice.numerator).div(
                clearingPrice.denominator
            )
        );
        settleUnmatchedAmountsToUniswap(
            unmatchedAmountToken0,
            clearingPrice,
            sellOrderToken0,
            uniswapPool
        );
        payOutTradeProceedings(sellOrderToken0, sellOrderToken1);
        emit BatchSettlement(
            sellOrderToken0.sellToken,
            sellOrderToken1.sellToken,
            sellOrderToken0.sellAmount.sub(unmatchedAmountToken0),
            sellOrderToken1.sellAmount
        );
    }

    function orderChecks(
        Order memory sellOrderToken0,
        Order memory sellOrderToken1
    ) public pure returns (bool) {
        return
            sellOrderToken0.sellToken == sellOrderToken1.buyToken &&
            sellOrderToken1.sellToken == sellOrderToken0.buyToken;
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
        order.buyAmount = newSellAmount.mul(order.buyAmount).div(
            order.sellAmount
        );
        order.sellAmount = newSellAmount;
        return order;
    }

    function parseOrderBytes(bytes memory orderBytes)
        public
        returns (Order memory order)
    {
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
            orderBytes,
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
        order = Order({
            sellAmount: sellAmount,
            buyAmount: buyAmount,
            buyToken: buyToken,
            sellToken: sellToken,
            owner: owner
        });
    }

    function calculateSettlementPrice(
        Order memory sellOrderToken0,
        Order memory sellOrderToken1,
        IUniswapV2Pair uniswapPool
    ) public view returns (Fraction memory clearingPrice) {
        (uint112 reserve0, uint112 reserve1, ) = uniswapPool.getReserves();
        uint256 uniswapK = uint256(reserve0).mul(reserve1);
        // if deltaUniswapToken0 will be > 0
        // if(sellOrderToken1.sellAmount * serve0 / reserve1 > sellToken2Order.sellAmount)
        uint256 p = uniswapK.div(
            uint256(2).mul(uint256(reserve1).add(sellOrderToken1.sellAmount))
        );
        uint256 newReserve0 = p.add(
            Math.sqrt(
                p.mul(p).add(
                    uniswapK.mul(sellOrderToken0.sellAmount).div(
                        uint256(reserve1).add(sellOrderToken1.sellAmount)
                    )
                )
            )
        );
        uint256 newReserve1 = uniswapK.div(newReserve0);
        clearingPrice = Fraction({
            numerator: newReserve0,
            denominator: newReserve1
        });
        require(
            clearingPrice.numerator.mul(sellOrderToken0.sellAmount) >=
                clearingPrice.denominator.mul(sellOrderToken0.buyAmount),
            "sellOrderToken0 price violations"
        );
        require(
            clearingPrice.numerator.mul(sellOrderToken1.sellAmount) >
                clearingPrice.denominator.mul(sellOrderToken1.buyAmount),
            "sellOrderToken1 price violations"
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

    function receiveTradeAmounts(
        Order memory sellOrderToken0,
        Order memory sellOrderToken1
    ) internal {
        require(
            IERC20(sellOrderToken0.sellToken).transferFrom(
                sellOrderToken0.owner,
                address(this),
                sellOrderToken0.sellAmount
            ),
            "unsuccessful transferFrom for token0"
        );
        require(
            IERC20(sellOrderToken1.sellToken).transferFrom(
                sellOrderToken1.owner,
                address(this),
                sellOrderToken1.sellAmount
            ),
            "unsuccessful transferFrom for token1"
        );
    }

    function payOutTradeProceedings(
        Order memory sellOrderToken0,
        Order memory sellOrderToken1
    ) internal {
        require(
            IERC20(sellOrderToken0.sellToken).transfer(
                sellOrderToken1.owner,
                IERC20(sellOrderToken0.sellToken).balanceOf(address(this))
            ),
            "final token transfer failed"
        );
        require(
            IERC20(sellOrderToken0.buyToken).transfer(
                sellOrderToken0.owner,
                IERC20(sellOrderToken0.buyToken).balanceOf(address(this))
            ),
            "final token1 transfer failed"
        );
    }
}
