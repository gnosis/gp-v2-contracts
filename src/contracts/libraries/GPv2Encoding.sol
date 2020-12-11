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
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        uint16 feeDiscount;
        address owner;
        bytes orderUid;
    }

    /// @dev The stride of an encoded trade.
    uint256 private constant TRADE_STRIDE = 206;

    /// @dev The byte length of an order unique identifier.
    uint256 private constant ORDER_UID_LENGTH = 56;

    /// @dev A struct representing arbitrary contract interactions.
    /// Submitted to [`GPv2Settlement.settle`] for code execution.
    struct Interaction {
        address target;
        bytes callData;
    }

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
    ///     uint16 feeDiscount;
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
    ) internal pure {
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint32 validTo;
        uint256 flags;
        uint8 v;
        bytes32 r;
        bytes32 s;

        // NOTE: Use assembly to efficiently decode packed data. Memory structs
        // in Solidity aren't packed, so the `Order` fields are in order at 32
        // byte increments.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // order = trade.order
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
            validTo := shr(224, calldataload(add(encodedTrade.offset, 66)))
            // order.appData = uint32(encodedTrade[70:74])
            mstore(
                add(order, 160),
                shr(224, calldataload(add(encodedTrade.offset, 70)))
            )
            // order.feeAmount = uint256(encodedTrade[74:106])
            mstore(add(order, 192), calldataload(add(encodedTrade.offset, 74)))
            // flags = uint8(encodedTrade[106])
            flags := shr(248, calldataload(add(encodedTrade.offset, 106)))
            // trade.executedAmount = uint256(encodedTrade[107:139])
            mstore(add(trade, 96), calldataload(add(encodedTrade.offset, 107)))
            // trade.feeDiscount = uint256(encodedTrade[139:141])
            mstore(
                add(trade, 128),
                shr(240, calldataload(add(encodedTrade.offset, 139)))
            )
            // v = uint8(encodedTrade[141])
            v := shr(248, calldataload(add(encodedTrade.offset, 141)))
            // r = uint256(encodedTrade[142:174])
            r := calldataload(add(encodedTrade.offset, 142))
            // s = uint256(encodedTrade[174:206])
            s := calldataload(add(encodedTrade.offset, 174))
        }

        trade.order.sellToken = tokens[sellTokenIndex];
        trade.order.buyToken = tokens[buyTokenIndex];
        trade.order.validTo = validTo;
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
        // <https://solidity.readthedocs.io/en/v0.7.5/internals/layout_in_memory.html>
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

        trade.owner = owner;

        // NOTE: Restore the free memory pointer to free temporary memory.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0x40, freeMemoryPointer)
        }

        // NOTE: Initialize the memory for the order UID if required.
        if (trade.orderUid.length != ORDER_UID_LENGTH) {
            trade.orderUid = new bytes(ORDER_UID_LENGTH);
        }

        // NOTE: Write the order UID to the allocated memory buffer. The order
        // parameters are written to memory in **reverse order** as memory
        // operations write 32-bytes at a time and we want to use a packed
        // encoding. This means, for example, that after writing the value of
        // `owner` to bytes `20:52`, writing the `orderDigest` to bytes `0:32`
        // will **overwrite** bytes `20:32`. This is desirable as addresses are
        // only 20 bytes and `20:32` should be `0`s:
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
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // orderUid = trade.orderUid.dataOffset
            let orderUid := add(mload(add(trade, 192)), 32)
            mstore(add(orderUid, 24), validTo)
            mstore(add(orderUid, 20), owner)
            mstore(orderUid, orderDigest)
        }
    }

    /// @dev Decodes an interaction from calldata into memory.
    ///
    /// An encoded interaction has three components: the target address, the data
    /// length, and the actual interaction data of variable size.
    ///
    /// ```
    /// struct EncodedInteraction {
    ///     address target;
    ///     uint24 dataLength;
    ///     bytes callData;
    /// }
    /// ```
    ///
    /// All entries are tightly packed together in this order in the encoded
    /// calldata. Example:
    ///
    /// input:    0x73c14081446bd1e4eb165250e826e80c5a523783000010000102030405060708090a0b0c0d0e0f
    /// decoding:   [...............target.................][leng][............data..............]
    /// stride:                                          20     3    (defined in length field) 16
    ///
    /// This function enforces that the encoded data stores enough bytes to
    /// cover the full length of the decoded interaction.
    ///
    /// The size of `dataLength` limits the maximum calldata that can be used in
    /// an interaction. Based on the current rules of the Ethereum protocol,
    /// this length is enough to include any valid transaction: an extra
    /// calldata byte costs at least 4 gas, and the maximum gas spent in a block
    /// is 12.5M. This gives an upper bound on the calldata that can be included
    /// in a block of
    ///   3.125.000 < 16.777.216 = 2**(3*8) .
    ///
    /// @param encodedInteractions The interactions as encoded calldata bytes.
    /// @param interaction The memory location to decode the interaction to.
    /// @return remainingEncodedInteractions The part of encodedInteractions that
    /// has not been decoded after this function is executed.
    function decodeInteraction(
        bytes calldata encodedInteractions,
        Interaction memory interaction
    ) internal pure returns (bytes calldata remainingEncodedInteractions) {
        uint256 dataLength;

        // Note: use assembly to efficiently decode packed data and store the
        // target address.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // interaction.target = address(encodedInteractions[0])
            mstore(
                interaction,
                shr(96, calldataload(encodedInteractions.offset))
            )

            // dataLength = uint24(encodedInteractions[1])
            dataLength := shr(
                232,
                calldataload(add(encodedInteractions.offset, 20))
            )
        }

        // Safety: dataLength fits a uint24, no overflow is possible.
        uint256 encodedInteractionSize = 20 + 3 + dataLength;
        require(
            encodedInteractions.length >= encodedInteractionSize,
            "GPv2: invalid interaction"
        );

        bytes calldata interactionCallData;
        // Note: assembly is used to split the calldata into two components, one
        // being the calldata of the current interaction and the other being the
        // encoded bytes of the remaining interactions.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            interactionCallData.offset := add(encodedInteractions.offset, 23)
            interactionCallData.length := dataLength

            remainingEncodedInteractions.offset := add(
                encodedInteractions.offset,
                encodedInteractionSize
            )
            remainingEncodedInteractions.length := sub(
                encodedInteractions.length,
                encodedInteractionSize
            )
        }

        // Solidity takes care of copying the calldata slice into memory.
        interaction.callData = interactionCallData;
    }

    /// @dev Extracts specific order information from the standardized unique
    /// order id of the protocol.
    ///
    /// @param orderUid The unique identifier used to represent an order in
    /// the protocol. This uid is the packed concatenation of the order digest,
    /// the validTo order parameter and the address of the user who created the
    /// order. It is used by the user to interface with the contract directly,
    /// and not by calls that are triggered by the solvers.
    /// @return orderDigest The EIP-712 signing digest derived from the order
    /// parameters.
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
}
