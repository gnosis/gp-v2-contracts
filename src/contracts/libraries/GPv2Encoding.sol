// SPDX-license-identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    /// @dev A struct representing an executed order that can be used for
    /// settling a batch.
    struct Order {
        address owner;
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        uint32 nonce;
        uint256 tip;
        OrderKind kind;
        bool partiallyFillable;
        uint256 executedAmount;
    }

    /// @dev An enum describing an order kind, either a buy or a sell order.
    enum OrderKind {Sell, Buy}

    /// @dev The stride of an encoded order.
    uint256 internal constant ORDER_STRIDE = 204;

    /// @dev Bit position for the [`OrderKind`] encoded in the flags.
    uint8 internal constant ORDER_KIND_BIT = 0;
    /// @dev Bit position for the `partiallyFillable` value encoded in the
    /// flags.
    uint8 internal constant ORDER_PARTIALLY_FILLABLE_BIT = 1;

    /// @dev Decodes a signed order from calldata bytes into memory.
    /// Orders are tightly packed in order to reduce calldata and associated gas
    /// costs. They contain the following fields:
    /// ```
    /// struct Order {
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
    /// @param tokens The list of tokens included in the settlement. The encoded
    /// token indices part of the order map to tokens in this array.
    /// @param encodedOrder The order as encoded calldata bytes.
    /// @param order The memory location to decode the order to.
    /// @return sellTokenIndex The index of the sell token in the token array.
    /// @return buyTokenIndex The index of the buy token in the token array.
    /// @return digest The 32-byte order hash.
    function decodeSignedOrder(
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        bytes calldata encodedOrder,
        Order memory order
    )
        internal
        view
        returns (
            uint8 sellTokenIndex,
            uint8 buyTokenIndex,
            bytes32 digest
        )
    {
        // NOTE: This is currently unnecessarily gas inefficient. Specifically,
        // there is a potentially extraneous check to the encoded order length
        // (this can be verified once for the total encoded orders length).
        // Additionally, Solidity generates bounds checks for each `abi.decode`
        // and slice operation. Unfortunately using `assmebly { calldataload }`
        // is quite ugly here since there is no mechanism to get calldata
        // offsets (like there is for memory offsets) without manual
        // computation, which is brittle as changes to the calling function
        // signature would require manual adjustments to the computation. Once
        // gas benchmarking is set up, we can evaluate if it is worth the extra
        // effort.

        require(
            encodedOrder.length == ORDER_STRIDE,
            "GPv2: malformed order data"
        );

        sellTokenIndex = uint8(encodedOrder[0]);
        order.sellToken = tokens[sellTokenIndex];
        buyTokenIndex = uint8(encodedOrder[1]);
        order.buyToken = tokens[buyTokenIndex];
        order.sellAmount = abi.decode(encodedOrder[2:], (uint256));
        order.buyAmount = abi.decode(encodedOrder[34:], (uint256));
        order.validTo = uint32(
            abi.decode(encodedOrder[66:], (uint256)) >> (256 - 32)
        );
        order.nonce = uint32(
            abi.decode(encodedOrder[70:], (uint256)) >> (256 - 32)
        );
        order.tip = abi.decode(encodedOrder[74:], (uint256));
        uint8 flags = uint8(encodedOrder[106]);
        order.executedAmount = abi.decode(encodedOrder[107:], (uint256));
        uint8 v = uint8(encodedOrder[139]);
        bytes32 r = abi.decode(encodedOrder[140:], (bytes32));
        bytes32 s = abi.decode(encodedOrder[172:], (bytes32));

        digest = keccak256(
            abi.encodePacked(
                domainSeparator,
                order.sellToken,
                order.buyToken,
                order.sellAmount,
                order.buyAmount,
                order.validTo,
                order.nonce,
                order.tip,
                flags
            )
        );
        order.owner = ecrecover(digest, v, r, s);
        require(order.owner != address(0), "GPv2: invalid signature");

        order.kind = OrderKind((flags >> ORDER_KIND_BIT) & 0x1);
        order.partiallyFillable =
            (flags >> ORDER_PARTIALLY_FILLABLE_BIT) & 0x01 == 0x01;
    }
}
