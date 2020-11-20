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
        uint32 nonce;
        uint256 tip;
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
    ///         "uint32 nonce," +
    ///         "uint256 tip," +
    ///         "uint8 kind," +
    ///         "bool partiallyFillable" +
    ///     ")"
    /// );
    /// ```
    bytes32 internal constant ORDER_TYPE_HASH =
        hex"70874c19b8f223ec3e4476223f761070db29e881be331cda28425f9079d3a76b";

    /// @dev A struct representing a trade to be executed as part a batch
    /// settlement.
    struct Trade {
        Order order;
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        bytes32 digest;
        address owner;
    }

    /// @dev The stride of an encoded trade.
    uint256 internal constant TRADE_STRIDE = 204;

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
    ///     uint32 nonce;
    ///     uint256 tip;
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
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        bytes calldata encodedTrade,
        Trade memory trade
    ) internal pure {
        // NOTE: It is slightly more efficient to check that the total encoded
        // trades length is a multiple of `TRADE_STRIDE` instead of checking
        // every encoded trade. Once that code is established, this check should
        // move there.
        require(
            encodedTrade.length == TRADE_STRIDE,
            "GPv2: malformed trade data"
        );

        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 flags;
        uint8 v;
        bytes32 r;
        bytes32 s;

        // NOTE: Use assembly to efficiently decode packed data. Memory structs
        // in Solidity aren't packed, so the `Order` fields are in order at 32
        // byte increments.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let order := mload(trade)

            // sellTokenIndex = uint8(encodedTrade[0])
            sellTokenIndex := shr(248, calldataload(encodedTrade.offset))
            // buyTokenIndex = uint8(encodedTrade[1])
            buyTokenIndex := shr(248, calldataload(add(encodedTrade.offset, 1)))
            // order.sellAmount = uint256(encodedTrade[2:34])
            mstore(add(order, 64), calldataload(add(encodedTrade.offset, 2)))
            // order.buyAmount = uint256(encodedTrade[34:66])
            mstore(add(order, 96), calldataload(add(encodedTrade.offset, 34)))
            // order.validTo = uint32(encodedTrade[66:70])
            mstore(
                add(order, 128),
                shr(224, calldataload(add(encodedTrade.offset, 66)))
            )
            // order.nonce = uint32(encodedTrade[70:74])
            mstore(
                add(order, 160),
                shr(224, calldataload(add(encodedTrade.offset, 70)))
            )
            // order.tip = uint256(encodedTrade[74:106])
            mstore(add(order, 192), calldataload(add(encodedTrade.offset, 74)))
            // flags = uint8(encodedTrade[106])
            flags := shr(248, calldataload(add(encodedTrade.offset, 106)))
            // trade.executedAmount = uint256(encodedTrade[107:139])
            mstore(add(trade, 96), calldataload(add(encodedTrade.offset, 107)))
            // v = uint8(encodedTrade[139])
            v := shr(248, calldataload(add(encodedTrade.offset, 139)))
            // r = uint256(encodedTrade[140:172])
            r := calldataload(add(encodedTrade.offset, 140))
            // s = uint256(encodedTrade[172:204])
            s := calldataload(add(encodedTrade.offset, 172))
        }

        trade.order.sellToken = tokens[sellTokenIndex];
        trade.order.buyToken = tokens[buyTokenIndex];
        trade.order.kind = OrderKind(flags & 0x01);
        trade.order.partiallyFillable = flags & 0x02 != 0;

        trade.sellTokenIndex = sellTokenIndex;
        trade.buyTokenIndex = buyTokenIndex;

        // NOTE: Compute the EIP-712 order struct hash in place. The hash is
        // computed from the order type hash concatenated with the ABI encoded
        // order fields for a total of `10 * sizeof(uint) = 320` bytes.
        // Fortunately, since Solidity memory structs **are not** packed, they
        // are already laid out in memory exactly as is needed to compute the
        // struct hash, just requiring the order type hash to be temporarily
        // writen to the memory slot coming right before the order data.
        bytes32 orderDigest;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let dataStart := sub(mload(trade), 32)
            let temp := mload(dataStart)
            mstore(dataStart, ORDER_TYPE_HASH)
            orderDigest := keccak256(dataStart, 320)
            mstore(dataStart, temp)
        }

        // NOTE: Solidity allocates, but does not free, memory when:
        // - calling the ABI encoding methods
        // - calling the `ecrecover` precompile.
        // However, we can restore the free memory pointer to before we made
        // allocations to effectively free the memory. This is safe as the
        // memory used can be discarded, and the memory pointed to by the free
        // memory pointer **does not have to point to zero-ed out memory**.
        // <https://solidity.readthedocs.io/en/v0.6.12/internals/layout_in_memory.html>
        uint256 freeMemoryPointer;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            freeMemoryPointer := mload(0x40)
        }

        bytes32 signingDigest;
        if (v & 0x80 == 0) {
            // NOTE: The most significant bit **is not set**, so the order is
            // signed using the EIP-712 sheme, the signing hash is of:
            // `"\x19\x01" || domainSeparator || orderDigest`.
            signingDigest = keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, orderDigest)
            );
        } else {
            // NOTE: The most significant bit **is set**, so the order is signed
            // using generic message scheme, the signing hash is of:
            // `"\x19Ethereum Signed Message:\n" || length || data` where the
            // length is a constant 64 bytes and the data is defined as:
            // `domainSeparator || orderDigest`.
            signingDigest = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n64",
                    domainSeparator,
                    orderDigest
                )
            );
        }

        address owner = ecrecover(signingDigest, v & 0x1f, r, s);
        require(owner != address(0), "GPv2: invalid signature");

        trade.digest = orderDigest;
        trade.owner = owner;

        // NOTE: Restore the free memory pointer to free temporary memory.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0x40, freeMemoryPointer)
        }
    }
}
