// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Encoding Library.
/// @author Gnosis Developers
library GPv2Encoding {
    /// @dev A struct representing an order.
    ///
    /// Note that this struct contains all order parameters that are signed by a
    /// user for submitting to GP. Additionally, we use an extra field for the
    /// order's type hash in order to allow for effecient in-place EIP-712
    /// struct hashing.
    struct Order {
        bytes32 typeHash;
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

    /// @dev The order EIP-712 type hash for the [`Order`] struct (excluding the
    /// extra `typeHash` field).
    bytes32 internal constant ORDER_TYPE_HASH =
        // TODO: Replace this with the pre-computed value once the contract is
        // ready to be deployed.
        keccak256(
            "Order(address sellToken,address buyToken,uint256 sellAmount,uint256 buyAmount,uint32 validTo,uint32 nonce,uint256 tip,uint8 kind,bool partiallyFillable)"
        );

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

    /// @dev Bit position for the [`OrderKind`] encoded in the flags.
    uint8 internal constant ORDER_KIND_BIT = 0;
    /// @dev Bit position for the `partiallyFillable` value encoded in the
    /// flags.
    uint8 internal constant ORDER_PARTIALLY_FILLABLE_BIT = 1;

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
        // NOTE: This is currently unnecessarily gas inefficient. Specifically,
        // there is a potentially extraneous check to the encoded trade length
        // (this can be verified once for the total encoded trades length).
        // Additionally, Solidity generates bounds checks for each `abi.decode`
        // and slice operation. Unfortunately using `assmebly { calldataload }`
        // is quite ugly here since there is no mechanism to get calldata
        // offsets (like there is for memory offsets) without manual
        // computation, which is brittle as changes to the calling function
        // signature would require manual adjustments to the computation. Once
        // gas benchmarking is set up, we can evaluate if it is worth the extra
        // effort.

        require(
            encodedTrade.length == TRADE_STRIDE,
            "GPv2: malformed trade data"
        );

        uint8 sellTokenIndex = uint8(encodedTrade[0]);
        uint8 buyTokenIndex = uint8(encodedTrade[1]);
        trade.order.sellAmount = abi.decode(encodedTrade[2:], (uint256));
        trade.order.buyAmount = abi.decode(encodedTrade[34:], (uint256));
        trade.order.validTo = uint32(
            abi.decode(encodedTrade[66:], (uint256)) >> (256 - 32)
        );
        trade.order.nonce = uint32(
            abi.decode(encodedTrade[70:], (uint256)) >> (256 - 32)
        );
        trade.order.tip = abi.decode(encodedTrade[74:], (uint256));
        uint8 flags = uint8(encodedTrade[106]);
        trade.executedAmount = abi.decode(encodedTrade[107:], (uint256));
        uint8 v = uint8(encodedTrade[139]);
        bytes32 r = abi.decode(encodedTrade[140:], (bytes32));
        bytes32 s = abi.decode(encodedTrade[172:], (bytes32));

        trade.order.typeHash = ORDER_TYPE_HASH;
        trade.order.sellToken = tokens[sellTokenIndex];
        trade.order.buyToken = tokens[buyTokenIndex];
        trade.order.kind = OrderKind((flags >> ORDER_KIND_BIT) & 0x1);
        trade.order.partiallyFillable =
            (flags >> ORDER_PARTIALLY_FILLABLE_BIT) & 0x01 == 0x01;

        trade.sellTokenIndex = sellTokenIndex;
        trade.buyTokenIndex = buyTokenIndex;

        // NOTE: In order to avoid memory allocation and copying of the order
        // parameters, use the memory region reserved by the caller for the
        // order result to effeciently compute the hash in place. Furthermore,
        // structs are not packed in Solidity, and there are 10 [`Order`] fields
        // to hash for a total of `10 * sizeof(uint) = 320` bytes. This digest
        // is a EIP-712 struct hash for the [`Order`] parameters.
        bytes32 orderDigest;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let order := mload(trade)
            orderDigest := keccak256(order, 320)
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
