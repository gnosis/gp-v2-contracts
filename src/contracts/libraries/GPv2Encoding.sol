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
    /// recovering the order address. Specifically, the first 10 fields are
    /// ordered precisely to allow hashing to occur in place.
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
    ///
    /// Note that this type hash does not include all fields like `owner` and
    /// `*TokenIndex`. This is because these fields are not signed but a part of
    /// the encoded order data and are useful to the settlement contract.
    bytes32 internal constant ORDER_TYPE_HASH =
        // TODO: Replace this with the pre-computed value once the contract is
        // ready to be deployed.
        keccak256(
            "Order(address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint32 validTo,uint32 nonce,uint256 tip,uint8 kind,bool partiallyFillable)"
        );

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
    ///   `v` signature parameter's most significant bit is set. This is done as
    ///   there are only two possible values `v` can have: 27 or 28, which only
    ///   take up the lower 5 bits of the `uint8`.
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
        order.executedAmount = abi.decode(encodedOrder[107:], (uint256));
        uint8 v = uint8(encodedOrder[139]);
        bytes32 r = abi.decode(encodedOrder[140:], (bytes32));
        bytes32 s = abi.decode(encodedOrder[172:], (bytes32));

        order.sellToken = tokens[sellTokenIndex];
        order.sellTokenIndex = sellTokenIndex;
        order.buyToken = tokens[buyTokenIndex];
        order.buyTokenIndex = buyTokenIndex;
        order.kind = OrderKind((flags >> ORDER_KIND_BIT) & 0x1);
        order.partiallyFillable =
            (flags >> ORDER_PARTIALLY_FILLABLE_BIT) & 0x01 == 0x01;

        // NOTE: In order to avoid a memory allocation per call by using the
        // built-in `abi.encode`, we reuse the memory region reserved by the
        // caller for the order result as input to compute the hash, using the
        // memory slot reserved for the order `owner` for the order type hash
        // which is required by EIP-712 as a prefix to the order data.
        // Furthermore structs are not packed in Solidity, and there is the
        // order type hash prefix followed by the 9 order fields to hash for a
        // total of `10 * sizeof(uint) = 320` bytes.
        bytes32 orderDigest;
        // TODO: This temporary stack variable is required as the compiler does
        // not support non-literal constants in inline assembly. This should be
        // removed once the constant is replaced with a pre-computed value for
        // deployment.
        bytes32 orderTypeHash = ORDER_TYPE_HASH;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(order, orderTypeHash)
            orderDigest := keccak256(order, 320)
        }

        // NOTE: Solidity allocates, but does not free, memory when calling the
        // ABI encoding methods as well as the `ecrecover` precompile. However,
        // we can restore the free memory pointer to before we made allocations
        // to effectively free the memory.
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

        address orderOwner = ecrecover(signingDigest, v & 0x1f, r, s);
        require(orderOwner != address(0), "GPv2: invalid signature");

        order.owner = orderOwner;
        order.digest = orderDigest;

        // NOTE: Restore the free memory pointer. This is safe as the memory
        // used can be discarded, and the memory pointed to by the free memory
        // pointer **does not have to point to zero-ed out memory**.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0x40, freeMemoryPointer)
        }
    }
}
