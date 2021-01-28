// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GPv2Signing.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    using GPv2Signing for bytes;

    /// @dev A struct representing an order containing all order parameters that
    /// are signed by a user for submitting to GP.
    struct Order {
        IERC20 sellToken;
        IERC20 buyToken;
        address receiver;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        bytes32 appData;
        uint256 feeAmount;
        bytes32 kind;
        bool partiallyFillable;
    }

    /// @dev A struct representing a trade to be executed as part a batch
    /// settlement.
    struct Trade {
        Order order;
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        uint256 feeDiscount;
        address owner;
        bytes orderUid;
    }

    /// @dev A struct representing arbitrary contract interactions.
    /// Submitted to [`GPv2Settlement.settle`] for code execution.
    struct Interaction {
        address target;
        uint256 value;
        bytes callData;
    }

    /// @dev The marker value for a sell order for computing the order struct
    /// hash. This allows the EIP-712 compatible wallets to display a
    /// descriptive string for the order kind (instead of 0 or 1).
    ///
    /// This value is pre-computed from the following expression:
    /// ```
    /// keccak256("sell")
    /// ```
    bytes32 internal constant ORDER_KIND_SELL =
        hex"f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";

    /// @dev The OrderKind marker value for a buy order for computing the order
    /// struct hash.
    ///
    /// This value is pre-computed from the following expression:
    /// ```
    /// keccak256("buy")
    /// ```
    bytes32 internal constant ORDER_KIND_BUY =
        hex"6ed88e868af0a1983e3886d5f3e95a2fafbd6c3450bc229e27342283dc429ccc";

    /// @dev The order EIP-712 type hash for the [`Order`] struct.
    ///
    /// This value is pre-computed from the following expression:
    /// ```
    /// keccak256(
    ///     "Order(" +
    ///         "address sellToken," +
    ///         "address buyToken," +
    ///         "address receiver," +
    ///         "uint256 sellAmount," +
    ///         "uint256 buyAmount," +
    ///         "uint32 validTo," +
    ///         "bytes32 appData," +
    ///         "uint256 feeAmount," +
    ///         "string kind," +
    ///         "bool partiallyFillable" +
    ///     ")"
    /// )
    /// ```
    bytes32 internal constant ORDER_TYPE_HASH =
        hex"d604be04a8c6d2df582ec82eba9b65ce714008acbf9122dd95e499569c8f1a80";

    /// @dev The byte length of an order unique identifier.
    uint256 private constant ORDER_UID_LENGTH = 56;

    /// @dev Flag identifying an order signed with EIP-712.
    uint256 private constant EIP712_SIGNATURE_ID = 0x0;
    /// @dev Flag identifying an order signed with eth_sign.
    uint256 private constant ETHSIGN_SIGNATURE_ID = 0x1;
    /// @dev Flag identifying an order signed with EIP-1271.
    uint256 private constant EIP1271_SIGNATURE_ID = 0x2;

    /// @dev Returns the number of trades encoded in a calldata byte array.
    ///
    /// The number of trades is encoded in the first two bytes, the remaining
    /// calldata stores the encoded trades. If no length is found, this method
    /// reverts.
    ///
    /// @param encodedTrades The encoded trades including the number of trades.
    /// @return count The total number of trades encoded in the specified bytes.
    /// @return remainingCalldata The remaining calldata storing the encoded
    /// trades.
    function decodeTradeCount(bytes calldata encodedTrades)
        internal
        pure
        returns (uint256 count, bytes calldata remainingCalldata)
    {
        require(encodedTrades.length >= 2, "GPv2: malformed trade data");

        // NOTE: Use assembly to slice the calldata bytes without generating
        // code for bounds checking.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // count = uint256(encodedTrades[0:16])
            count := shr(240, calldataload(encodedTrades.offset))
            // remainingCalldata = encodedTrades[16:]
            remainingCalldata.offset := add(encodedTrades.offset, 2)
            remainingCalldata.length := sub(encodedTrades.length, 2)
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
    ///     address receiver?;             // only present if the receiver bit
    ///                                    // is 1 (see below)
    ///     bytes sellAmount;
    ///     uint256 buyAmount;
    ///     uint32 validTo;
    ///     uint8 appDataStride;
    ///     bytes appData;                 // size determined by previous byte
    ///     uint256 feeAmount;
    ///     uint8 flags;
    ///     uint256 executedAmount;        // only present if partially fillable
    ///                                    // flag is 1 (see below)
    ///     uint8 feeDiscountStride;
    ///     bytes feeDiscount;             // size determined by previous byte
    ///     bytes signature;               // size determined by the signature
    ///                                    // type (see below)
    /// }
    /// ```
    ///
    /// The signature encoding depends on the scheme used to sign. The owner of
    /// the order can be derived from the signature. See the [`GPv2Signing`]
    /// library to learn how signatures are encoded for each supported encoding.
    ///
    /// Trade flags are used to tightly encode information on how to decode
    /// an order. Examples that directly affect the structure of an order are
    /// the kind of order (either a sell or a buy order) as well as whether the
    /// order is partially fillable or if it is a "fill-or-kill" order. It also
    /// encodes the signature scheme used to validate the order. As the most
    /// likely values are fill-or-kill sell orders by an externally owned
    /// account, the flags are chosen such that `0x00` represents this kind of
    /// order. The flags byte uses the following format:
    ///
    /// ```
    /// bit | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
    /// ----+-----------------------+---+---+
    ///     | * | * |  unused   | * | * | * |
    ///       |   |               |   |   |
    ///       |   |               |   |   +---- order kind bit, 0 for a sell
    ///       |   |               |   |         order and 1 for a buy order
    ///       |   |               |   |
    ///       |   |               |   +-------- order fill bit, 0 for fill-or-
    ///       |   |               |             kill and 1 for a partially
    ///       |   |               |             fillable order
    ///       |   |               |
    ///       |   |               +------------ receiver bit, 0 if the funds
    ///       |   |                             bought with this order should
    ///       |   |                             be sent to the signer, 1 if
    ///       |   |                             a different receiver is encoded.
    ///       |   |
    ///       +---+---------------------------- signature-type bits:
    ///                                         00: EIP-712
    ///                                         01: eth_sign
    ///                                         10: EIP-1271
    ///                                         11: unused
    /// ```
    ///
    /// @param domainSeparator The domain separator used for signing the order.
    /// @param tokens The list of tokens included in the settlement. The token
    /// indices in the encoded order parameters map to tokens in this array.
    /// @param encodedTrade The trade as encoded calldata bytes.
    /// @param trade The memory location to decode trade to.
    /// @return remainingCalldata Input calldata that has not been used while
    /// decoding the current order.
    function decodeTrade(
        bytes calldata encodedTrade,
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        Trade memory trade
    ) internal view returns (bytes calldata remainingCalldata) {
        uint32 validTo;
        bytes32 orderDigest;
        uint256 flags;
        uint256 unprocessedCalldataPointer;

        // This scope is needed to clear variables from the stack after use and
        // avoids stack too deep errors.
        {
            uint8 sellTokenIndex;
            uint8 buyTokenIndex;

            GPv2Encoding.Order memory order = trade.order;

            // NOTE: Use assembly to efficiently decode packed data. Memory
            // structs in Solidity aren't packed, so the `Order` fields are in
            // order at 32 byte increments.

            // solhint-disable-next-line no-inline-assembly
            assembly {
                unprocessedCalldataPointer := encodedTrade.offset

                // uint8 flags;
                flags := shr(248, calldataload(unprocessedCalldataPointer))
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 1)

                // uint8 sellTokenIndex;
                sellTokenIndex := shr(
                    248,
                    calldataload(unprocessedCalldataPointer)
                )
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 1)

                // uint8 buyTokenIndex;
                buyTokenIndex := shr(
                    248,
                    calldataload(unprocessedCalldataPointer)
                )
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 1)

                // if third flag bit from the right is set (receiver flag)
                if gt(and(flags, 4), 0) {
                    // address order.receiver;
                    mstore(
                        add(order, 64),
                        shr(96, calldataload(unprocessedCalldataPointer))
                    )
                    unprocessedCalldataPointer := add(
                        unprocessedCalldataPointer,
                        20
                    )
                }

                // uint256 order.sellAmount
                mstore(add(order, 96), calldataload(unprocessedCalldataPointer))
                unprocessedCalldataPointer := add(
                    unprocessedCalldataPointer,
                    32
                )

                // uint256 order.buyAmount;
                mstore(
                    add(order, 128),
                    calldataload(unprocessedCalldataPointer)
                )
                unprocessedCalldataPointer := add(
                    unprocessedCalldataPointer,
                    32
                )

                // uint32 validTo;
                validTo := shr(224, calldataload(unprocessedCalldataPointer))
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 4)

                // uint8 appDataLength; // 0 <= appDataLength <= 32
                let appDataLength := shr(
                    248,
                    calldataload(unprocessedCalldataPointer)
                )
                if gt(appDataLength, 32) {
                    // "GPv2: appData too long"
                    revert(0, 0)
                }
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 1)
                // bytes32 order.appData;
                mstore(
                    add(order, 192),
                    shr(
                        sub(256, mul(8, appDataLength)),
                        calldataload(unprocessedCalldataPointer)
                    )
                )
                unprocessedCalldataPointer := add(
                    unprocessedCalldataPointer,
                    appDataLength
                )

                // uint256 order.feeAmount;
                mstore(
                    add(order, 224),
                    calldataload(unprocessedCalldataPointer)
                )
                unprocessedCalldataPointer := add(
                    unprocessedCalldataPointer,
                    32
                )

                // if second flag bit from the right is set (partialy fillable)
                if gt(and(flags, 2), 0) {
                    // uint256 trade.executedAmount;
                    mstore(
                        add(trade, 96),
                        calldataload(unprocessedCalldataPointer)
                    )
                    unprocessedCalldataPointer := add(
                        unprocessedCalldataPointer,
                        32
                    )
                }

                // uint8 feeDiscountStride; // 0 <= feeDiscountStride <= 32
                let feeDiscountStride := shr(
                    248,
                    calldataload(unprocessedCalldataPointer)
                )
                if gt(feeDiscountStride, 32) {
                    // "GPv2: feeAmount too long"
                    revert(0, 0)
                }
                unprocessedCalldataPointer := add(unprocessedCalldataPointer, 1)
                // uint256 order.feeAmount;
                mstore(
                    add(trade, 128),
                    shr(
                        sub(256, mul(8, feeDiscountStride)),
                        calldataload(unprocessedCalldataPointer)
                    )
                )
                unprocessedCalldataPointer := add(
                    unprocessedCalldataPointer,
                    feeDiscountStride
                )
            }

            order.sellToken = tokens[sellTokenIndex];
            order.buyToken = tokens[buyTokenIndex];
            order.validTo = validTo;
            if (flags & 0x01 == 0) {
                order.kind = ORDER_KIND_SELL;
            } else {
                order.kind = ORDER_KIND_BUY;
            }
            order.partiallyFillable = flags & 0x02 != 0;

            trade.sellTokenIndex = sellTokenIndex;
            trade.buyTokenIndex = buyTokenIndex;

            // NOTE: Compute the EIP-712 order struct hash in place. The hash is
            // computed from the order type hash concatenated with the ABI
            // encoded order fields for a total of `11 * sizeof(uint) = 352`
            // bytes. Fortunately, since Solidity memory structs **are not**
            // packed, they are already laid out in memory exactly as is needed
            // to compute the struct hash, just requiring the order type hash to
            // be temporarily written to the memory slot coming right before the
            // order data.
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let dataStart := sub(order, 32)
                let temp := mload(dataStart)
                mstore(dataStart, ORDER_TYPE_HASH)
                orderDigest := keccak256(dataStart, 352)
                mstore(dataStart, temp)
            }
        }

        bytes calldata signature;

        // NOTE: Use assembly to slice the calldata bytes without generating
        // code for bounds checking and accessing the calldata offset and length
        // parameters.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let usedCalldataLength := sub(
                unprocessedCalldataPointer,
                encodedTrade.offset
            )

            if gt(usedCalldataLength, encodedTrade.length) {
                // "GPv2: trade data too short"
                revert(0, 0)
            }

            signature.offset := unprocessedCalldataPointer
            signature.length := sub(encodedTrade.length, usedCalldataLength)
        }

        address owner;
        flags = flags >> 6;
        if (flags == EIP712_SIGNATURE_ID) {
            (owner, remainingCalldata) = signature.recoverEip712Signer(
                domainSeparator,
                orderDigest
            );
        } else if (flags == ETHSIGN_SIGNATURE_ID) {
            (owner, remainingCalldata) = signature.recoverEthsignSigner(
                domainSeparator,
                orderDigest
            );
        } else if (flags == EIP1271_SIGNATURE_ID) {
            (owner, remainingCalldata) = signature.recoverEip1271Signer(
                domainSeparator,
                orderDigest
            );
        } else {
            revert("GPv2: invalid signature scheme");
        }
        trade.owner = owner;

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
    /// An encoded interaction has four components: the target address, the
    /// optional call value, the data length, and the actual interaction data of
    /// variable size.
    ///
    /// ```
    /// struct EncodedInteraction {
    ///     address target;
    ///     bytes1 hasValue;
    ///     uint24 dataLength;
    ///     uint256? value;
    ///     bytes callData;
    /// }
    /// ```
    ///
    /// All entries are tightly packed together in this order in the encoded
    /// calldata. Examples:
    ///
    /// input:    0x73c14081446bd1e4eb165250e826e80c5a523783_00_000010_____000102030405060708090a0b0c0d0e0f
    /// decoding:   [...............target.................][hv][leng][val][............data..............]
    /// stride:                                          20   1     3    0    (defined in length field) 16
    ///
    /// input:    0x0000000000000000000000000000000000000000_01_0000000000000000000000000000000000000000000000000000000de0b6b3a7640000
    /// decoding:   [...............target.................][hv][leng][............................value.............................][data]
    /// stride:                                          20   1     3                                                              32     0
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
    /// @return remainingCalldata The part of encodedInteractions that has not
    /// been decoded after this function is executed.
    function decodeInteraction(
        bytes calldata encodedInteractions,
        Interaction memory interaction
    ) internal pure returns (bytes calldata remainingCalldata) {
        bool hasValue;
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

            // hasValue = bool(encodedInteractions[20])
            hasValue := iszero(
                iszero(
                    shr(248, calldataload(add(encodedInteractions.offset, 20)))
                )
            )

            // dataLength = uint24(encodedInteractions[21:24])
            dataLength := shr(
                232,
                calldataload(add(encodedInteractions.offset, 21))
            )
        }

        // Safety: dataLength fits a uint24, no overflow is possible.
        uint256 encodedInteractionSize = 20 + 1 + 3 + dataLength;
        if (hasValue) {
            encodedInteractionSize += 32;
        }
        require(
            encodedInteractions.length >= encodedInteractionSize,
            "GPv2: invalid interaction"
        );

        uint256 value;
        bytes calldata interactionCallData;
        // Note: assembly is used to split the calldata into two components, one
        // being the calldata of the current interaction and the other being the
        // encoded bytes of the remaining interactions.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            switch hasValue
                case 0 {
                    interactionCallData.offset := add(
                        encodedInteractions.offset,
                        24
                    )
                }
                default {
                    value := calldataload(add(encodedInteractions.offset, 24))
                    interactionCallData.offset := add(
                        encodedInteractions.offset,
                        56
                    )
                }
            interactionCallData.length := dataLength

            remainingCalldata.offset := add(
                encodedInteractions.offset,
                encodedInteractionSize
            )
            remainingCalldata.length := sub(
                encodedInteractions.length,
                encodedInteractionSize
            )
        }

        interaction.value = value;
        // Solidity takes care of copying the calldata slice into memory.
        interaction.callData = interactionCallData;
    }

    /// @dev Returns the number of order UIDs packed in a calldata byte array.
    ///
    /// This method reverts if the order UIDs data is malformed, i.e. the total
    /// length is not a multiple of the length of a single order UID.
    ///
    /// @param orderUids The packed order UIDs.
    /// @return count The total number of order UIDs packed in the specified
    /// bytes.
    function orderUidCount(bytes calldata orderUids)
        internal
        pure
        returns (uint256 count)
    {
        require(
            orderUids.length % ORDER_UID_LENGTH == 0,
            "GPv2: malformed order UIDs"
        );
        count = orderUids.length / ORDER_UID_LENGTH;
    }

    /// @dev Returns a calldata slice to an order UID at the specified index.
    ///
    /// Note that this method does not check that the index is within the bounds
    /// of the specified packed order UIDs, and is expected to be verified by
    /// the caller, typically, with a call to [`orderUidCount`].
    function orderUidAtIndex(bytes calldata orderUids, uint256 index)
        internal
        pure
        returns (bytes calldata orderUid)
    {
        // NOTE: Use assembly to slice the calldata bytes without generating
        // code for bounds checking.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            orderUid.offset := add(
                orderUids.offset,
                mul(index, ORDER_UID_LENGTH)
            )
            orderUid.length := ORDER_UID_LENGTH
        }
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
