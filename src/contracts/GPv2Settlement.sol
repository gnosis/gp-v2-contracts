// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./GPv2AllowanceManager.sol";
import "./interfaces/GPv2Authentication.sol";
import "./libraries/GPv2Encoding.sol";
import "./libraries/GPv2TradeExecution.sol";

/// @title Gnosis Protocol v2 Settlement Contract
/// @author Gnosis Developers
contract GPv2Settlement {
    using GPv2Encoding for bytes;
    using GPv2TradeExecution for GPv2TradeExecution.Data;
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
    /// See [`orderUidKey`] for how an order key is defined.
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
    /// @param orderUid The unique identifier of the order that is to be made
    /// invalid after calling this function. The user that created the order
    /// must be the the sender of this message. See [`extractOrderUidParams`]
    /// for details on orderUid.
    function invalidateOrder(bytes calldata orderUid) external {
        (bytes32 orderDigest, address owner, uint32 validTo) =
            extractOrderUidParams(orderUid);
        require(owner == msg.sender, "GPv2: caller does not own order");
        filledAmount[orderUidKey(orderDigest, msg.sender, validTo)] = uint256(
            -1
        );
    }

    /// @dev Return how much of the input order has been filled so far. See
    /// [`filledAmount`] to know how this value depends on the order type.
    /// @param orderUid The unique identifier associated to the order for which
    /// to recover the filled amount. See [`extractOrderUidParams`] for details.
    /// @return amount How much the order has been filled in absolute amount.
    function getFilledAmount(bytes calldata orderUid)
        external
        view
        returns (uint256 amount)
    {
        (bytes32 orderDigest, address owner, uint32 validTo) =
            extractOrderUidParams(orderUid);
        amount = filledAmount[orderUidKey(orderDigest, owner, validTo)];
    }

    /// @dev Process all trades for EOA orders one at a time returning the
    /// computed net in and out transfers for the trades.
    ///
    /// This method reverts if processing of any single trade fails. See
    /// [`processOrder`] for more details.
    /// @param tokens An array of ERC20 tokens to be traded in the settlement.
    /// @param clearingPrices An array of token clearing prices.
    /// @param encodedTrades Encoded trades for signed EOA orders.
    /// @return executedTrades Array of executed trades.
    function computeTradeExecutions(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        bytes calldata encodedTrades
    ) internal returns (GPv2TradeExecution.Data[] memory executedTrades) {
        uint256 tradeCount = encodedTrades.tradeCount();
        executedTrades = new GPv2TradeExecution.Data[](tradeCount);

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
                executedTrades[i]
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
    /// @param executedTrade Memory location for computed executed trade data.
    function computeTradeExecution(
        GPv2Encoding.Trade memory trade,
        uint256 sellPrice,
        uint256 buyPrice,
        GPv2TradeExecution.Data memory executedTrade
    ) internal {
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

        executedTrade.owner = trade.owner;
        executedTrade.sellToken = order.sellToken;
        executedTrade.buyToken = order.buyToken;

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

        bytes32 uidKey = orderUidKey(trade.digest, trade.owner, order.validTo);
        uint256 currentFilledAmount = filledAmount[uidKey];

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

            currentFilledAmount = currentFilledAmount.add(executedSellAmount);
            require(
                currentFilledAmount <= order.sellAmount,
                "GPv2: order filled"
            );
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

            currentFilledAmount = currentFilledAmount.add(executedBuyAmount);
            require(
                currentFilledAmount <= order.buyAmount,
                "GPv2: order filled"
            );
        }

        executedTrade.sellAmount = executedSellAmount.add(executedFeeAmount);
        executedTrade.buyAmount = executedBuyAmount;

        filledAmount[uidKey] = currentFilledAmount;
    }

    /// @dev Allows settlment function to make arbitrary contract executions.
    /// @param interaction contains address and calldata of the contract interaction.
    function executeInteraction(GPv2Encoding.Interaction memory interaction)
        internal
    {
        // To prevent possible attack on user funds, we explicitly disable
        // interactions with AllowanceManager contract.
        require(
            interaction.target != address(allowanceManager),
            "GPv2: forbidden interaction"
        );
        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory response) =
            (interaction.target).call(interaction.callData);
        // solhint-enable avoid-low-level-calls

        // TODO - concatenate the following reponse "GPv2: Failed Interaction"
        // This is the topic of https://github.com/gnosis/gp-v2-contracts/issues/240
        if (!success) {
            // Assembly used to revert with correctly encoded error message.
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(response, 0x20), mload(response))
            }
        }
    }

    /// @dev Extracts specific order information from the standardized unique
    /// order id of the protocol.
    /// @param orderUid The unique identifier used to represent an order in
    /// the protocol. This uid is the packed concatenation of the order digest,
    /// the validTo order parameter and the address of the user who created the
    /// order. It is used by the user to interface with the contract directly,
    /// and not by calls that are triggered by the solvers.
    /// @return orderDigest The unique digest associated to the parameters of an
    /// order. See [`orderUidKey`] for details.
    /// @return owner The address of the user who owns this order.
    /// @return validTo The epoch time at which the order will stop being valid.
    function extractOrderUidParams(bytes calldata orderUid)
        internal
        pure
        returns (
            bytes32 orderDigest,
            address owner,
            uint32 validTo
        )
    {
        require(orderUid.length == 32 + 20 + 4, "GPv2: invalid uid");
        // Use assembly to efficiently decode packed calldata.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            orderDigest := calldataload(orderUid.offset)
            owner := shr(96, calldataload(add(orderUid.offset, 32)))
            validTo := shr(224, calldataload(add(orderUid.offset, 52)))
        }
    }

    /// @dev Transfers all buy amounts for the executed trades from the
    /// settlement contract to the order owners. This function reverts if any of
    /// the ERC20 operations fail.
    ///
    /// @param trades The executed trades whose buy amounts need to be
    /// transferred out.
    function transferOut(GPv2TradeExecution.Data[] memory trades) internal {
        for (uint256 i = 0; i < trades.length; i++) {
            trades[i].transferBuyAmountToOwner();
        }
    }

    /// @dev Compute the key used to access, in the mapping of filled amounts,
    /// the user order described by the input parameters.
    /// @param orderDigest The unique digest associated to the parameters of an
    /// order (an instance of the Order struct in the [`GPv2Encoding`] library).
    /// The order digest is the (unpacked) hash of all entries in the order in
    /// which they appear.
    /// @param owner The address of the user that is assigned to the order.
    /// @param validTo The epoch time at which the order will stop being valid.
    /// @return uid Key of the given order in the [`filledAmount`] mapping.
    function orderUidKey(
        bytes32 orderDigest,
        address owner,
        uint32 validTo
    ) internal pure returns (bytes32 uid) {
        // NOTE: Use the 64 bytes of scratch space starting at memory address 0
        // for computing this hash instead of allocating. We hash a total of 56
        // bytes and write to memory in **reverse order** as memory operations
        // write 32-bytes at a time and we want to use a packed encoding. This
        // means, for example, that after writing the value of `owner` to bytes
        // `20:52`, writing the `orderDigest` to bytes `0:32` will **overwrite**
        // bytes `20:32`. This is desirable as addresses are only 20 bytes and
        // `20:32` should be `0`s:
        //
        //        |           1111111111222222222233333333334444444444555555
        //   byte | 01234567890123456789012345678901234567890123456789012345
        // -------+---------------------------------------------------------
        //  field | [.........orderDigest..........][......owner.......][vT]
        // -------+---------------------------------------------------------
        // mstore |                         [000000000000000000000000000.vT]
        //        |                     [00000000000.......owner.......]
        //        | [.........orderDigest..........]
        //
        // <https://docs.soliditylang.org/en/v0.7.5/internals/layout_in_memory.html>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(24, validTo)
            mstore(20, owner)
            mstore(0, orderDigest)
            uid := keccak256(0, 56)
        }
    }
}
