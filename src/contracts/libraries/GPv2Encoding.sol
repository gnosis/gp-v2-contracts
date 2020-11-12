// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    /// @dev A struct representing an executed order that can be used for
    /// settling a batch.
    ///
    /// The memory layout for an order is very important for optimizations for
    /// recovering the order address. Specifically, all the signed order
    /// parameters appear in contiguous memory as the first 9 fields from
    /// `sellToken` to `partiallyFillable`. This allows the memory reserved for
    /// decoding an order to also be used for computing the order digest during
    /// the decoding process for some added effeciency.
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
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        bytes32 digest;
        address owner;
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
    ///
    /// Orders are tightly packed and compress some data such as buy and sell
    /// tokens in order to reduce calldata size and associated gas costs. As
    /// such it is not identical to the decoded [`Order`] and contains the
    /// following fields:
    /// ```
    /// struct EncodedOrder {
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
    /// @param domainSeparator The domain separator used for hashing and signing
    /// the order.
    /// @param tokens The list of tokens included in the settlement. The encoded
    /// token indices part of the order map to tokens in this array.
    /// @param encodedOrder The order as encoded calldata bytes.
    /// @param order The memory location to decode the order to.
    function decodeSignedOrder(
        bytes32 domainSeparator,
        IERC20[] calldata tokens,
        bytes calldata encodedOrder,
        Order memory order
    ) internal pure {
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

        order.sellTokenIndex = uint8(encodedOrder[0]);
        order.buyTokenIndex = uint8(encodedOrder[1]);
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

        order.sellToken = tokens[order.sellTokenIndex];
        order.buyToken = tokens[order.buyTokenIndex];
        order.kind = OrderKind((flags >> ORDER_KIND_BIT) & 0x1);
        order.partiallyFillable =
            (flags >> ORDER_PARTIALLY_FILLABLE_BIT) & 0x01 == 0x01;

        bytes32 orderDigest;
        bytes32 signingDigest;

        // NOTE: In order to avoid a memory allocation per call by using the
        // built-in `abi.encode`, we reuse the memory region reserved by the
        // caller for the order result as input to compute the hash.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // NOTE: Structs are not packed in Solidity, and there are 9 order
            // fields to hash for a total of `9 * sizeof(uint) = 288` bytes.
            orderDigest := keccak256(order, 288)
        }

        // NOTE: Now compute the digest that was used for signing. This is not
        // the same as the order digest as it includes a message signature
        // prefix as well as the domain separator. This is done using a scratch
        // region of Solidity memory past the last allocation (which is stored
        // at `0x40` memory address).
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let scratch := mload(0x40)

            // NOTE: Message prefix is right-padded with 0's so that the first
            // byte of the message prefix is at `scratch` memory location. 4 0's
            // are needed as the message prefix is exactly 28 bytes long.
            // Consequently, the two hashes are stored at 28 and 60 bytes from
            // the start of the message, and the total length is 92 bytes.
            mstore(scratch, "\x19Ethereum Signed Message:\n64\x00\x00\x00\x00")
            mstore(add(scratch, 28), domainSeparator)
            mstore(add(scratch, 60), orderDigest)
            signingDigest := keccak256(scratch, 92)
        }

        order.digest = orderDigest;
        order.owner = ecrecover(signingDigest, v, r, s);

        require(order.owner != address(0), "GPv2: invalid signature");
    }
}
