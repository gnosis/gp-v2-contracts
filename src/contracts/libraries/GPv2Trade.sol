// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GPv2Order.sol";
import "./GPv2Signing.sol";

/// @title Gnosis Protocol v2 Trade Library.
/// @author Gnosis Developers
library GPv2Trade {
    using GPv2Order for GPv2Order.Data;
    using GPv2Order for bytes;
    using GPv2Signing for GPv2Order.Data;

    /// @dev A struct representing a trade to be executed as part a batch
    /// settlement.
    struct Data {
        uint256 sellTokenIndex;
        uint256 buyTokenIndex;
        address receiver;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        bytes32 appData;
        uint256 feeAmount;
        uint256 flags;
        uint256 executedAmount;
        uint256 feeDiscount;
        bytes signature;
    }

    /// @dev Recovered trade data containing the extracted order and the
    /// recovered owner address.
    struct Recovered {
        GPv2Order.Data order;
        bytes orderUid;
        address owner;
        uint256 executedAmount;
        uint256 feeDiscount;
    }

    /// @dev Returns a new recovered trade with a pre-allocated buffer for
    /// packing the order unique identifier.
    function newRecovered() internal pure returns (Recovered memory trade) {
        trade.orderUid = new bytes(GPv2Order.UID_LENGTH);
    }

    /// @dev Recovers trade data from the specified settlement trade input.
    ///
    /// @param trade Memory location used for writing the recovered trade data.
    /// @param domainSeparator The domain separator used for signing the order.
    /// @param tokens The list of tokens included in the settlement. The token
    /// indices in the trade parameters map to tokens in this array.
    /// @param input The input settlement trade data to recover the order and
    /// signer from.
    function recoverTrade(
        Recovered memory trade,
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        GPv2Trade.Data calldata input
    ) internal view {
        GPv2Order.Data memory order = trade.order;

        GPv2Signing.Scheme signingScheme =
            GPv2Trade.extractOrder(input, tokens, order);
        (bytes32 orderDigest, address owner) =
            order.recoverOrderSigner(
                domainSeparator,
                signingScheme,
                input.signature
            );

        trade.orderUid.packOrderUidParams(orderDigest, owner, order.validTo);
        trade.owner = owner;
        trade.executedAmount = input.executedAmount;
        trade.feeDiscount = input.feeDiscount;
    }

    /// @dev Extracts the order data and signing scheme for the specified trade.
    ///
    /// @param trade The trade.
    /// @param tokens The list of tokens included in the settlement. The token
    /// indices in the trade parameters map to tokens in this array.
    /// @param order The memory location to extract the order data to.
    function extractOrder(
        Data calldata trade,
        IERC20[] calldata tokens,
        GPv2Order.Data memory order
    ) internal pure returns (GPv2Signing.Scheme signingScheme) {
        order.sellToken = tokens[trade.sellTokenIndex];
        order.buyToken = tokens[trade.buyTokenIndex];
        order.receiver = trade.receiver;
        order.sellAmount = trade.sellAmount;
        order.buyAmount = trade.buyAmount;
        order.validTo = trade.validTo;
        order.appData = trade.appData;
        order.feeAmount = trade.feeAmount;
        (order.kind, order.partiallyFillable, signingScheme) = extractFlags(
            trade.flags
        );
    }

    /// @dev Decodes trade flags.
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
    /// bit | 31 ... 4 | 3 | 2 | 1 | 0 |
    /// ----+-----------------------+---+---+
    ///     |  unused  | *   * | * | * |
    ///                  |   |   |   |
    ///                  |   |   |   +---- order kind bit, 0 for a sell order
    ///                  |   |   |         and 1 for a buy order
    ///                  |   |   |
    ///                  |   |   +-------- order fill bit, 0 for fill-or-kill
    ///                  |   |             and 1 for a partially fillable order
    ///                  |   |
    ///                  +---+------------ signature scheme bits:
    ///                                    00: EIP-712
    ///                                    01: eth_sign
    ///                                    10: EIP-1271
    ///                                    11: unused
    /// ```
    function extractFlags(uint256 flags)
        internal
        pure
        returns (
            bytes32 kind,
            bool partiallyFillable,
            GPv2Signing.Scheme signingScheme
        )
    {
        if (flags & 0x01 == 0) {
            kind = GPv2Order.SELL;
        } else {
            kind = GPv2Order.BUY;
        }
        partiallyFillable = flags & 0x02 != 0;
        signingScheme = GPv2Signing.Scheme(flags >> 2);
    }
}
