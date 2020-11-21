// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    /// @dev A struct representing an order containing all order parameters that
    /// are signed by a user for submitting to GP.
    struct Order {
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        uint32 appData;
        uint256 feeAmount;
        OrderKind kind;
        bool partiallyFillable;
    }

    /// @dev An enum describing an order kind, either a buy or a sell order.
    enum OrderKind {Sell, Buy}

    /// @dev The order EIP-712 type hash for the [`Order`] struct.
    ///
    /// This value is pre-computed from the following expression:
    /// ```
    /// keccak256(
    ///     "Order(" +
    ///         "address sellToken," +
    ///         "address buyToken," +
    ///         "uint256 sellAmount," +
    ///         "uint256 buyAmount," +
    ///         "uint32 validTo," +
    ///         "uint32 appData," +
    ///         "uint256 feeAmount," +
    ///         "uint8 kind," +
    ///         "bool partiallyFillable" +
    ///     ")"
    /// );
    /// ```
    bytes32 internal constant ORDER_TYPE_HASH =
        hex"b71968fcf5e55b9c3370f2809d4078a4695be79dfa43e5aa1f2baa0a9b84f186";

    /// @dev A struct representing a trade to be executed as part a batch
    /// settlement.
    struct Trade {
        Order order;
        uint256 sellTokenIndex;
        uint256 buyTokenIndex;
        uint256 executedAmount;
        bytes32 digest;
        address owner;
    }

    /// @dev The stride of an encoded trade.
    uint256 private constant TRADE_STRIDE = 204;

    /// @dev Returns the number of trades encoded in a calldata byte array.
    ///
    /// This method reverts if the encoded trades are malformed, i.e. the total
    /// length is not a multiple of the stride of a single trade.
    /// @param encodedTrades The encoded trades.
    /// @return count The total number of trades encoded in the specified bytes.
    function tradeCount(bytes calldata encodedTrades)
        internal
        pure
        returns (uint256 count)
    {
        require(
            encodedTrades.length % TRADE_STRIDE == 0,
            "GPv2: malformed trade data"
        );
        count = encodedTrades.length / TRADE_STRIDE;
    }

    /// @dev Returns a calldata slice to an encoded trade at the specified
    /// index.
    ///
    /// Note that this method does not check that the index is within the bounds
    /// of the specified encoded trades, as reading calldata out of bounds just
    /// produces 0's and will just decode to an invalid trade that will either
    /// fail to recover an address or recover a bogus one.
    function tradeAtIndex(bytes calldata encodedTrades, uint256 index)
        internal
        pure
        returns (bytes calldata encodedTrade)
    {
        // NOTE: Use assembly to slice the calldata bytes without generating
        // code for bounds checking.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            encodedTrade.offset := add(
                encodedTrades.offset,
                mul(index, TRADE_STRIDE)
            )
            encodedTrade.length := TRADE_STRIDE
        }
    }

    /// @dev Decodes a trade with a signed order from calldata into memory.
    ///
    /// Trades are tightly packed and compress some data such as the order's buy
    /// and sell tokens to reduce calldata size and associated gas costs. As
    /// such it is not identical to the decoded [`Trade`] and contains the
    /// following fields:
    ///
    /// ```
    /// struct EncodedTrade {
    ///     uint8 sellTokenIndex;
    ///     uint8 buyTokenIndex;
    ///     uint256 sellAmount;
    ///     uint256 buyAmount;
    ///     uint32 validTo;
    ///     uint32 appData;
    ///     uint256 feeAmount;
    ///     uint8 flags;
    ///     uint256 executedAmount;
    ///     Signature {
    ///         uint8 v;
    ///         bytes32 r;
    ///         bytes32 s;
    ///     } signature;
    /// }
    /// ```
    ///
    /// Order flags are used to encode additional order parameters such as the
    /// kind of order, either a sell or a buy order, as well as whether the
    /// order is partially fillable or if it is a "fill-or-kill" order. As the
    /// most likely values are fill-or-kill sell orders, the flags are chosen
    /// such that `0x00` represents this kind of order. The flags byte uses has
    /// the following format:
    /// ```
    /// bit | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
    /// ----+-----------------------+---+---+
    ///     |        unsused        | * | * |
    ///                               |   |
    ///                               |   +---- order kind bit, 0 for a sell
    ///                               |         order and 1 for a buy order
    ///                               |
    ///                               +-------- order fill bit, 0 for fill-or-
    ///                                         kill and 1 for a partially
    ///                                         fillable order
    /// ```
    ///
    /// Order signatures support two schemes:
    /// - EIP-712 for signing typed data, this is the default scheme that will
    ///   be used when recovering the signing address from the signature.
    /// - Generic message signature, this scheme will be used **only** if the
    ///   `v` signature parameter's most significant bit is set. This is done as
    ///   there are only two possible values `v` can have: 27 or 28, which only
    ///   take up the lower 5 bits of the `uint8`.
    ///
    /// @param domainSeparator The domain separator used for signing the order.
    /// @param tokens The list of tokens included in the settlement. The token
    /// indices in the encoded order parameters map to tokens in this array.
    /// @param encodedTrade The trade as encoded calldata bytes.
    /// @param trade The memory location to decode trade to.
    function decodeTrade(
        bytes calldata encodedTrade,
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        Trade memory trade
    ) internal view {
        // NOTE: Use assembly to efficiently decode packed data and recover the
        // signing address.
        bool validIndices;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let order := mload(trade)
            let freeMemoryPointer := mload(0x40)

            {
                // sellTokenIndex = uint256(encodedTrade[0])
                let sellTokenIndex := shr(
                    248,
                    calldataload(encodedTrade.offset)
                )
                // order.sellToken = tokens[sellTokenIndex]
                mstore(
                    order,
                    calldataload(add(tokens.offset, mul(sellTokenIndex, 32)))
                )
                // trade.sellTokenIndex = sellTokenIndex
                mstore(add(trade, 32), sellTokenIndex)
                // validIndices = sellTokenIndex < tokens.length
                validIndices := lt(sellTokenIndex, tokens.length)
            }
            {
                // buyTokenIndex = uint256(encodedTrade[1])
                let buyTokenIndex := shr(
                    248,
                    calldataload(add(encodedTrade.offset, 1))
                )
                // order.buyToken = tokens[buyTokenIndex]
                mstore(
                    add(order, 32),
                    calldataload(add(tokens.offset, mul(buyTokenIndex, 32)))
                )
                // trade.buyTokenIndex = buyTokenIndex
                mstore(add(trade, 64), buyTokenIndex)
                // validIndices = validIndices && buyTokenIndex < tokens.length
                validIndices := and(
                    validIndices,
                    lt(buyTokenIndex, tokens.length)
                )
            }
            // order.sellAmount = uint256(encodedTrade[2:34])
            mstore(add(order, 64), calldataload(add(encodedTrade.offset, 2)))
            // order.buyAmount = uint256(encodedTrade[34:66])
            mstore(add(order, 96), calldataload(add(encodedTrade.offset, 34)))
            // order.validTo = uint32(encodedTrade[66:70])
            mstore(
                add(order, 128),
                shr(224, calldataload(add(encodedTrade.offset, 66)))
            )
            // order.appData = uint32(encodedTrade[70:74])
            mstore(
                add(order, 160),
                shr(224, calldataload(add(encodedTrade.offset, 70)))
            )
            // order.feeAmount = uint256(encodedTrade[74:106])
            mstore(add(order, 192), calldataload(add(encodedTrade.offset, 74)))
            {
                // flags = uint8(encodedTrade[106])
                let flags := shr(
                    248,
                    calldataload(add(encodedTrade.offset, 106))
                )
                // order.kind = OrderKind(flags & 0x01)
                mstore(add(order, 224), and(flags, 0x01))
                // order.partiallyFillable = flags & 0x02 != 0
                mstore(add(order, 256), shr(1, and(flags, 0x02)))
            }
            // trade.executedAmount = uint256(encodedTrade[107:139])
            mstore(add(trade, 96), calldataload(add(encodedTrade.offset, 107)))

            // NOTE: Compute the EIP-712 order struct hash in place. The hash is
            // computed from the order type hash concatenated with the ABI encoded
            // order fields for a total of `10 * sizeof(uint) = 320` bytes.
            // Fortunately, since Solidity memory structs **are not** packed, they
            // are already laid out in memory exactly as is needed to compute the
            // struct hash, just requiring the order type hash to be temporarily
            // writen to the memory slot coming right before the order data.
            let orderDigest
            {
                let dataStart := sub(order, 32)
                let backup := mload(dataStart)
                mstore(dataStart, ORDER_TYPE_HASH)
                orderDigest := keccak256(dataStart, 320)
                mstore(dataStart, backup)
            }
            // trade.digest = orderDigest
            mstore(add(trade, 128), orderDigest)

            // v = uint8(encodedTrade[139])
            let v := shr(248, calldataload(add(encodedTrade.offset, 139)))

            switch and(v, 0x80)
                case 0 {
                    mstore(freeMemoryPointer, "\x19\x01")
                    mstore(add(freeMemoryPointer, 2), domainSeparator)
                    mstore(add(freeMemoryPointer, 34), orderDigest)
                    mstore(freeMemoryPointer, keccak256(freeMemoryPointer, 66))
                }
                default {
                    mstore(
                        freeMemoryPointer,
                        "\x19Ethereum Signed Message:\n64"
                    )
                    mstore(add(freeMemoryPointer, 28), domainSeparator)
                    mstore(add(freeMemoryPointer, 60), orderDigest)
                    mstore(freeMemoryPointer, keccak256(freeMemoryPointer, 92))
                }
            mstore(add(freeMemoryPointer, 32), and(v, 0x1f))
            mstore(
                add(freeMemoryPointer, 64),
                calldataload(add(encodedTrade.offset, 140))
            )
            mstore(
                add(freeMemoryPointer, 96),
                calldataload(add(encodedTrade.offset, 172))
            )
            // trade.owner = ecrecover(signingDigest, v, r, s)
            if iszero(
                staticcall(
                    gas(),
                    0x01,
                    freeMemoryPointer,
                    128,
                    add(trade, 160),
                    32
                )
            ) {
                // NOTE: This indicates there was something wrong calling the
                // precompile and not that the signature recovery failed.
                revert(0, 0)
            }
        }

        require(validIndices, "GPv2: invalid token index");
        require(trade.owner != address(0), "GPv2: invalid signature");
    }
}
