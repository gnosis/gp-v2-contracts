// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./GPv2AllowanceManager.sol";
import "./interfaces/GPv2Authentication.sol";
import "./libraries/GPv2Encoding.sol";

/// @title Gnosis Protocol v2 Settlement Contract
/// @author Gnosis Developers
contract GPv2Settlement {
    using GPv2Encoding for bytes;
    using SafeMath for uint256;

    /// @dev The EIP-712 domain type hash used for computing the domain
    /// separator.
    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    /// @dev The EIP-712 domain name used for computing the domain separator.
    bytes32 private constant DOMAIN_NAME = keccak256("Gnosis Protocol");

    /// @dev The EIP-712 domain version used for computing the domain separator.
    bytes32 private constant DOMAIN_VERSION = keccak256("v2");

    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible. This domain
    /// separator is computed following the EIP-712 standard and has replay
    /// protection mixed in so that signed orders are only valid for specific
    /// GPv2 contracts.
    bytes32 internal immutable domainSeparator;

    /// @dev The authenticator is used to determine who can call the settle function.
    /// That is, only authorised solvers have the ability to invoke settlements.
    /// Any valid authenticator implements an isSolver method called by the onlySolver
    /// modifier below.
    GPv2Authentication private immutable authenticator;

    /// @dev The allowance manager which has access to EOA order funds. This
    /// contract is created during deployment
    GPv2AllowanceManager internal immutable allowanceManager;

    /// @dev Map each user order to the amount that has been filled so far. If
    /// this amount is larger than or equal to the amount traded in the order
    /// (amount sold for sell orders, amount bought for buy orders) then the
    /// order cannot be traded anymore. If the order is fill or kill, then this
    /// value is only used to determine whether the order has already been
    /// executed.
    /// See [`orderUid`] for how to represent an order with a single bytes32.
    mapping(bytes32 => uint256) public filledAmount;

    constructor(GPv2Authentication authenticator_) {
        authenticator = authenticator_;

        // NOTE: Currently, the only way to get the chain ID in solidity is
        // using assembly.
        uint256 chainId;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPE_HASH,
                DOMAIN_NAME,
                DOMAIN_VERSION,
                chainId,
                address(this)
            )
        );
        allowanceManager = new GPv2AllowanceManager();
    }

    /// @dev This modifier is called by settle function to block any non-listed
    /// senders from settling batches.
    modifier onlySolver {
        require(authenticator.isSolver(msg.sender), "GPv2: not a solver");
        _;
    }

    /// @dev Settle the specified orders at a clearing price. Note that it is
    /// the responsibility of the caller to ensure that all GPv2 invariants are
    /// upheld for the input settlement, otherwise this call will revert.
    /// Namely:
    /// - The fee factor cannot lead to fees > 0.1%
    /// - All orders are valid and signed
    /// - Accounts have sufficient balance and approval.
    /// - Settlement contract has sufficient balance to execute trades. Note
    ///   this implies that the accumulated fees held in the contract can also
    ///   be used for settlement. This is OK since:
    ///   - Solvers need to be authorized
    ///   - Misbehaving solvers will be slashed for abusing accumulated fees for
    ///     settlement
    ///   - Critically, user orders are entirely protected
    ///
    /// Note that some parameters are encoded as packed bytes in order to save
    /// calldata gas. For more information on encoding format consult the
    /// [`GPv2Encoding`] library.
    ///
    /// @param tokens An array of ERC20 tokens to be traded in the settlement.
    /// Orders and interactions encode tokens as indices into this array.
    /// @param clearingPrices An array of clearing prices where the `i`-th price
    /// is for the `i`-th token in the [`tokens`] array.
    /// @param encodedTrades Encoded trades for signed EOA orders.
    /// @param encodedInteractions Encoded smart contract interactions.
    /// @param encodedOrderRefunds Encoded order refunds for clearing storage
    /// related to invalid orders.
    function settle(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata encodedTrades,
        bytes calldata encodedInteractions,
        bytes calldata encodedOrderRefunds
    ) external view onlySolver {
        require(tokens.length == 0, "not yet implemented");
        require(clearingPrices.length == 0, "not yet implemented");
        require(encodedTrades.length == 0, "not yet implemented");
        require(encodedInteractions.length == 0, "not yet implemented");
        require(encodedOrderRefunds.length == 0, "not yet implemented");
        revert("Final: not yet implemented");
    }

    /// @dev Invalidate onchain an order that has been signed offline.
    /// @param orderDigest The unique digest associated to the parameters of an
    /// order. See [`orderUid`] for details.
    function invalidateOrder(bytes32 orderDigest) public {
        filledAmount[orderUid(orderDigest, msg.sender)] = uint256(-1);
    }

    /// @dev Process all trades for EOA orders one at a time returning the
    /// computed net in and out transfers for the trades.
    ///
    /// This method reverts if processing of any single trade fails. See
    /// [`processOrder`] for more details.
    /// @param tokens An array of ERC20 tokens to be traded in the settlement.
    /// @param clearingPrices An array of token clearing prices.
    /// @param encodedTrades Encoded trades for signed EOA orders.
    /// @return inTransfers Array of transfers into the settlement contract.
    /// @return outTransfers Array of transfers to pay out to EOAs.
    function computeTradeExecutions(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata encodedTrades
    )
        internal
        view
        returns (
            GPv2AllowanceManager.Transfer[] memory inTransfers,
            GPv2AllowanceManager.Transfer[] memory outTransfers
        )
    {
        uint256 tradeCount = encodedTrades.tradeCount();
        inTransfers = new GPv2AllowanceManager.Transfer[](tradeCount);
        outTransfers = new GPv2AllowanceManager.Transfer[](tradeCount);

        GPv2Encoding.Trade memory trade;
        for (uint256 i = 0; i < tradeCount; i++) {
            encodedTrades.tradeAtIndex(i).decodeTrade(
                domainSeparator,
                tokens,
                trade
            );
            computeTradeExecution(
                trade,
                clearingPrices[trade.sellTokenIndex],
                clearingPrices[trade.buyTokenIndex],
                inTransfers[i],
                outTransfers[i]
            );
        }
    }

    /// @dev Compute the in and out transfer amounts for a single EOA order
    /// trade. This function reverts if:
    /// - The order has expired
    /// - The order's limit price is not respected.
    ///
    /// @param trade The trade to process.
    /// @param sellPrice The price of the order's sell token.
    /// @param buyPrice The price of the order's buy token.
    /// @param inTransfer Memory location to set computed tranfer into the
    /// settlement contract to execute trade.
    /// @param outTransfer Memory location to set computed transfer out to order
    /// owner to execute trade.
    function computeTradeExecution(
        GPv2Encoding.Trade memory trade,
        uint256 sellPrice,
        uint256 buyPrice,
        GPv2AllowanceManager.Transfer memory inTransfer,
        GPv2AllowanceManager.Transfer memory outTransfer
    ) internal view {
        GPv2Encoding.Order memory order = trade.order;
        // NOTE: Currently, the above instanciation allocates an unitialized
        // `Order` that gets never used. Adjust the free memory pointer to free
        // the unused memory by subtracting `sizeof(Order) == 288` bytes.
        // <https://solidity.readthedocs.io/en/v0.7.5/internals/layout_in_memory.html>
        // TODO: Remove this once the following fix is merged and released:
        // <https://github.com/ethereum/solidity/pull/10341>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0x40, sub(mload(0x40), 288))
        }

        // solhint-disable-next-line not-rely-on-time
        require(order.validTo >= block.timestamp, "GPv2: order expired");

        inTransfer.owner = trade.owner;
        inTransfer.token = order.sellToken;
        outTransfer.owner = trade.owner;
        outTransfer.token = order.buyToken;

        // NOTE: The following computation is derived from the equation:
        // ```
        // amount_x * price_x = amount_y * price_y
        // ```
        // Intuitively, if a chocolate bar is 0,50€ and a beer is 4€, 1 beer
        // is roughly worth 8 chocolate bars (`1 * 4 = 8 * 0.5`). From this
        // equation, we can derive:
        // - The limit price for selling `x` and buying `y` is respected iff
        // ```
        // limit_x * price_x >= limit_y * price_y
        // ```
        // - The executed amount of token `y` given some amount of `x` and
        //   clearing prices is:
        // ```
        // amount_y = amount_x * price_x / price_y
        // ```

        require(
            order.sellAmount.mul(sellPrice) >= order.buyAmount.mul(buyPrice),
            "GPv2: limit price not respected"
        );

        uint256 executedSellAmount;
        uint256 executedBuyAmount;
        uint256 executedFeeAmount;

        // NOTE: Don't use `SafeMath.div` anywhere here as it allocates a string
        // even if it does not revert. The method only checks that the divisor
        // is non-zero and `revert`s in that case instead of consuming all of
        // the remaining transaction gas when dividing by zero.
        if (order.kind == GPv2Encoding.OrderKind.Sell) {
            if (order.partiallyFillable) {
                executedSellAmount = trade.executedAmount;
                executedFeeAmount =
                    order.feeAmount.mul(executedSellAmount) /
                    order.sellAmount;
            } else {
                executedSellAmount = order.sellAmount;
                executedFeeAmount = order.feeAmount;
            }

            executedBuyAmount = executedSellAmount.mul(sellPrice) / buyPrice;
        } else {
            if (order.partiallyFillable) {
                executedBuyAmount = trade.executedAmount;
                executedFeeAmount =
                    order.feeAmount.mul(executedBuyAmount) /
                    order.buyAmount;
            } else {
                executedBuyAmount = order.buyAmount;
                executedFeeAmount = order.feeAmount;
            }

            executedSellAmount = executedBuyAmount.mul(buyPrice) / sellPrice;
        }

        inTransfer.amount = executedSellAmount.add(executedFeeAmount);
        outTransfer.amount = executedBuyAmount;
    }

    /// @dev Compute a unique identifier that represents a user order.
    /// @param orderDigest The unique digest associated to the parameters of an
    /// order (an instance of the Order struct in the [`GPv2Encoding`] library).
    /// The order digest is the (unpacked) hash of all entries in the order in
    /// which they appear.
    /// @param owner The address of the user to assign to the order.
    function orderUid(bytes32 orderDigest, address owner)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(orderDigest, owner));
    }
}
