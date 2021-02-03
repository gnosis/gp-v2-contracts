// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GPv2Order.sol";
import "./GPv2Signing.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    using GPv2Order for GPv2Order.Data;
    using GPv2Order for bytes;
    using GPv2Signing for bytes;

    /// @dev A struct representing a trade to be executed as part a batch
    /// settlement.
    struct Trade {
        GPv2Order.Data order;
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        uint256 feeDiscount;
        address owner;
        bytes orderUid;
    }

    /// @dev The length of the fixed-length components in an encoded trade.
    uint256 private constant CONSTANT_SIZE_TRADE_LENGTH = 219;

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
    ///     address receiver;
    ///     uint256 sellAmount;
    ///     uint256 buyAmount;
    ///     uint32 validTo;
    ///     bytes32 appData;
    ///     uint256 feeAmount;
    ///     uint8 flags;
    ///     uint256 executedAmount;
    ///     uint256 feeDiscount;
    ///     bytes signature;
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
    ///     | * | * |    unused     | * | * |
    ///       |   |                   |   |
    ///       |   |                   |   +---- order kind bit, 0 for a sell
    ///       |   |                   |         order and 1 for a buy order
    ///       |   |                   |
    ///       |   |                   +-------- order fill bit, 0 for fill-or-
    ///       |   |                             kill and 1 for a partially
    ///       |   |                             fillable order
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
        require(
            encodedTrade.length >= CONSTANT_SIZE_TRADE_LENGTH,
            "GPv2: invalid trade"
        );

        uint32 validTo;
        bytes32 orderDigest;
        uint256 flags;

        // This scope is needed to clear variables from the stack after use and
        // avoids stack too deep errors.
        {
            uint8 sellTokenIndex;
            uint8 buyTokenIndex;

            GPv2Order.Data memory order = trade.order;

            // NOTE: Use assembly to efficiently decode packed data. Memory
            // structs in Solidity aren't packed, so the `Order` fields are in
            // order at 32 byte increments.
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // sellTokenIndex = uint8(encodedTrade[0])
                sellTokenIndex := shr(248, calldataload(encodedTrade.offset))
                // buyTokenIndex = uint8(encodedTrade[1])
                buyTokenIndex := shr(
                    248,
                    calldataload(add(encodedTrade.offset, 1))
                )
                // order.receiver = uint256(encodedTrade[2:22])
                mstore(
                    add(order, 64),
                    shr(96, calldataload(add(encodedTrade.offset, 2)))
                )
                // order.sellAmount = uint256(encodedTrade[22:54])
                mstore(
                    add(order, 96),
                    calldataload(add(encodedTrade.offset, 22))
                )
                // order.buyAmount = uint256(encodedTrade[54:86])
                mstore(
                    add(order, 128),
                    calldataload(add(encodedTrade.offset, 54))
                )
                // validTo = uint32(encodedTrade[86:90])
                validTo := shr(224, calldataload(add(encodedTrade.offset, 86)))
                // order.appData = uint32(encodedTrade[90:122])
                mstore(
                    add(order, 192),
                    calldataload(add(encodedTrade.offset, 90))
                )
                // order.feeAmount = uint256(encodedTrade[122:154])
                mstore(
                    add(order, 224),
                    calldataload(add(encodedTrade.offset, 122))
                )
                // flags = uint8(encodedTrade[154])
                flags := shr(248, calldataload(add(encodedTrade.offset, 154)))
                // trade.executedAmount = uint256(encodedTrade[155:187])
                mstore(
                    add(trade, 96),
                    calldataload(add(encodedTrade.offset, 155))
                )
                // trade.feeDiscount = uint256(encodedTrade[187:219])
                mstore(
                    add(trade, 128),
                    calldataload(add(encodedTrade.offset, 187))
                )
            }

            order.sellToken = tokens[sellTokenIndex];
            order.buyToken = tokens[buyTokenIndex];
            order.validTo = validTo;
            if (flags & 0x01 == 0) {
                order.kind = GPv2Order.SELL;
            } else {
                order.kind = GPv2Order.BUY;
            }
            order.partiallyFillable = flags & 0x02 != 0;

            trade.sellTokenIndex = sellTokenIndex;
            trade.buyTokenIndex = buyTokenIndex;

            orderDigest = order.hash();
        }

        bytes calldata signature;
        // NOTE: Use assembly to slice the calldata bytes without generating
        // code for bounds checking.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            signature.offset := add(
                encodedTrade.offset,
                CONSTANT_SIZE_TRADE_LENGTH
            )
            signature.length := sub(
                encodedTrade.length,
                CONSTANT_SIZE_TRADE_LENGTH
            )
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
        if (trade.orderUid.length != GPv2Order.UID_LENGTH) {
            trade.orderUid = new bytes(GPv2Order.UID_LENGTH);
        }
        trade.orderUid.packOrderUidParams(orderDigest, owner, validTo);
    }
}
