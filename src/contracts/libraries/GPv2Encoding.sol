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
    /// parameters appear in contiguous memory, the 9 fields from `sellToken` to
    /// `partiallyFillable`. This allows the memory reserved for decoding an
    /// order to also be used for computing the order digest during the decoding
    /// process for some added effeciency.
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
        uint8 sellTokenIndex;
        uint8 buyTokenIndex;
        uint256 executedAmount;
        bytes32 digest;
    }

    /// @dev An enum describing an order kind, either a buy or a sell order.
    enum OrderKind {Sell, Buy}

    /// @dev The stride of an encoded order.
    uint256 internal constant ORDER_STRIDE = 204;

    /// @dev The order EIP-712 type hash.
    bytes32 internal constant ORDER_TYPE_HASH =
        0x70874c19b8f223ec3e4476223f761070db29e881be331cda28425f9079d3a76b;

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
    ///
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
    /// Order signatures support two schemes:
    /// - EIP-712 for signing typed data, this is the default scheme that will
    ///   be used when recovering the signing address from the signature.
    /// - Generic message signature, this scheme will be used **only** if the
    ///   `v` signature parameter's MSB is set. This is done as there are only
    ///   two possible values `v` can have: 27 or 28, which only take up the
    ///   lower 5 bits of the `uint8`.
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

        uint8 sellTokenIndex = uint8(encodedOrder[0]);
        uint8 buyTokenIndex = uint8(encodedOrder[1]);
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
        uint256 executedAmount = abi.decode(encodedOrder[107:], (uint256));
        uint8 v = uint8(encodedOrder[139]);
        bytes32 r = abi.decode(encodedOrder[140:], (bytes32));
        bytes32 s = abi.decode(encodedOrder[172:], (bytes32));

        order.sellToken = tokens[sellTokenIndex];
        order.buyToken = tokens[buyTokenIndex];
        order.kind = OrderKind((flags >> ORDER_KIND_BIT) & 0x1);
        order.partiallyFillable =
            (flags >> ORDER_PARTIALLY_FILLABLE_BIT) & 0x01 == 0x01;

        bytes32 orderDigest;

        // NOTE: In order to avoid a memory allocation per call by using the
        // built-in `abi.encode`, we reuse the memory region reserved by the
        // caller for the order result as input to compute the hash.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // NOTE: Structs are not packed in Solidity, and there is the order
            // type hash, which is temporarily stored in the slot reserved for
            // the `owner` field as well as 9 order fields to hash for a total
            // of `10 * sizeof(uint) = 320` bytes.
            mstore(order, ORDER_TYPE_HASH)
            orderDigest := keccak256(order, 320)
        }

        bytes32 signingDigest;

        // NOTE: Now compute the digest that was used for signing. This is not
        // the same as the order digest as it is dependant on the signature
        // scheme being used. In both cases, the signing digest is computed from
        // a prefix followed by the domain separator and finally the order
        // the order digest:
        // - If the order is signed using the EIP-712 sheme, then the prefix is
        //   the 2-byte value 0x1901,
        // - If the order is signed using generic message scheme, then the
        //   prefix is the 28-byte "\x19Ethereum Signed Message\n64" where 64 is
        //   the length the domain separator and order digest.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // NOTE: Use the region of memory dedicated to the last 4 order
            // fields to compute the hash in order to prevent further memory
            // allocations. This is safe as those words have not yet been set
            // and their values are being stored in stack variables.
            // Specifically we use:
            // - `sellTokenIndex` field slot for the prefix (320 byte offset),
            // - `buyTokenIndex` field slot for the domain separator (352 byte
            //    offset),
            // - `executedAmount` field slot for the order digest (384 byte
            //    offset),
            mstore(add(order, 352), domainSeparator)
            mstore(add(order, 384), orderDigest)
            switch and(v, 0x80)
                case 0 {
                    mstore(add(order, 320), 0x1901)
                    signingDigest := keccak256(add(order, 350), 66)
                }
                default {
                    mstore(
                        add(order, 320),
                        // NOTE: Strings are left-padded, so add 0's to make it
                        // right padded instead.
                        "\x00\x00\x00\x00\x19Ethereum Signed Message:\n64"
                    )
                    signingDigest := keccak256(add(order, 324), 92)
                }
        }

        order.owner = ecrecover(signingDigest, v & 0x1f, r, s);
        order.sellTokenIndex = sellTokenIndex;
        order.buyTokenIndex = buyTokenIndex;
        order.executedAmount = executedAmount;
        order.digest = orderDigest;

        require(order.owner != address(0), "GPv2: invalid signature");
    }
}
