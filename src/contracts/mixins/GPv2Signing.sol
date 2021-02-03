// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "../interfaces/GPv2EIP1271.sol";
import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Trade.sol";

/// @title Gnosis Protocol v2 Signing Library.
/// @author Gnosis Developers
abstract contract GPv2Signing {
    using GPv2Order for GPv2Order.Data;
    using GPv2Order for bytes;

    /// @dev Recovered trade data containing the extracted order and the
    /// recovered owner address.
    struct RecoveredOrder {
        GPv2Order.Data data;
        bytes uid;
        address owner;
    }

    /// @dev Signing scheme used for recovery.
    enum Scheme {Eip712, EthSign, Eip1271}

    /// @dev The EIP-712 domain type hash used for computing the domain
    /// separator.
    bytes32 private constant DOMAIN_TYPE_HASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    /// @dev The EIP-712 domain name used for computing the domain separator.
    bytes32 private constant DOMAIN_NAME = keccak256("Gnosis Protocol");

    /// @dev The EIP-712 domain version used for computing the domain separator.
    bytes32 private constant DOMAIN_VERSION = keccak256("v2");

    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible. This domain
    /// separator is computed following the EIP-712 standard and has replay
    /// protection mixed in so that signed orders are only valid for specific
    /// GPv2 contracts.
    bytes32 public immutable domainSeparator;

    constructor() {
        // NOTE: Currently, the only way to get the chain ID in solidity is
        // using assembly.
        uint256 chainId;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPE_HASH,
                DOMAIN_NAME,
                DOMAIN_VERSION,
                chainId,
                address(this)
            )
        );
    }

    /// @dev Returns an empty recovered order with a pre-allocated buffer for
    /// packing the unique identifier.
    ///
    /// @return recoveredOrder The empty recovered order data.
    function allocateRecoveredOrder()
        internal
        pure
        returns (RecoveredOrder memory recoveredOrder)
    {
        recoveredOrder.uid = new bytes(GPv2Order.UID_LENGTH);
    }

    /// @dev Extracts order data and recovers the signer from the specified
    /// trade.
    ///
    /// @param recoveredOrder Memory location used for writing the recovered order data.
    /// @param tokens The list of tokens included in the settlement. The token
    /// indices in the trade parameters map to tokens in this array.
    /// @param trade The trade data to recover the order data from.
    function recoverOrderFromTrade(
        RecoveredOrder memory recoveredOrder,
        IERC20[] calldata tokens,
        GPv2Trade.Data calldata trade
    ) internal view {
        GPv2Order.Data memory order = recoveredOrder.data;

        Scheme signingScheme = GPv2Trade.extractOrder(trade, tokens, order);
        (bytes32 orderDigest, address owner) =
            recoverOrderSigner(order, signingScheme, trade.signature);

        recoveredOrder.uid.packOrderUidParams(
            orderDigest,
            owner,
            order.validTo
        );
        recoveredOrder.owner = owner;
    }

    /// @dev The length of any signature from an externally owned account.
    uint256 private constant ECDSA_SIGNATURE_LENGTH = 65;

    /// @dev Recovers an order's signer from the specified order and signature.
    ///
    /// @param order The order to recover a signature for.
    /// @param signingScheme The signing scheme.
    /// @param signature The signature bytes.
    /// @return orderDigest The computed order hash.
    /// @return owner The recovered address from the specified signature.
    function recoverOrderSigner(
        GPv2Order.Data memory order,
        Scheme signingScheme,
        bytes calldata signature
    ) internal view returns (bytes32 orderDigest, address owner) {
        orderDigest = order.hash();
        if (signingScheme == Scheme.Eip712) {
            owner = recoverEip712Signer(signature, orderDigest);
        } else if (signingScheme == Scheme.EthSign) {
            owner = recoverEthsignSigner(signature, orderDigest);
        } else if (signingScheme == Scheme.Eip1271) {
            owner = recoverEip1271Signer(signature, orderDigest);
        }
    }

    /// @dev Decodes ECDSA signatures from calldata.
    ///
    /// The first bytes of the input tightly pack the signature parameters
    /// specified in the following struct:
    ///
    /// ```
    /// struct EncodedSignature {
    ///     bytes32 r;
    ///     bytes32 s;
    ///     uint8 v;
    /// }
    /// ```
    ///
    /// Unused signature data is returned along with the address of the signer.
    /// If the encoding is not valid, for example because the calldata does not
    /// suffice, the function reverts.
    ///
    /// @param encodedSignature Calldata pointing to tightly packed signature
    /// bytes.
    /// @return r r parameter of the ECDSA signature.
    /// @return s s parameter of the ECDSA signature.
    /// @return v v parameter of the ECDSA signature.
    function decodeEcdsaSignature(bytes calldata encodedSignature)
        internal
        pure
        returns (
            bytes32 r,
            bytes32 s,
            uint8 v
        )
    {
        require(
            encodedSignature.length == ECDSA_SIGNATURE_LENGTH,
            "GPv2: malformed ecdsa signature"
        );

        // NOTE: Use assembly to efficiently decode signature data.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // r = uint256(encodedSignature[0:32])
            r := calldataload(encodedSignature.offset)
            // s = uint256(encodedSignature[32:64])
            s := calldataload(add(encodedSignature.offset, 32))
            // v = uint8(encodedSignature[64])
            v := shr(248, calldataload(add(encodedSignature.offset, 64)))
        }
    }

    /// @dev Decodes signature bytes originating from an EIP-712-encoded
    /// signature.
    ///
    /// EIP-712 signs typed data. The specifications are described in the
    /// related EIP (<https://eips.ethereum.org/EIPS/eip-712>).
    ///
    /// EIP-712 signatures are encoded as standard ECDSA signatures as described
    /// in the corresponding decoding function [`decodeEcdsaSignature`].
    ///
    /// Unused signature data is returned along with the address of the signer.
    /// If the signature is not valid, the function reverts.
    ///
    /// @param encodedSignature Calldata pointing to tightly packed signature
    /// bytes.
    /// @param orderDigest The EIP-712 signing digest derived from the order
    /// parameters.
    /// @return owner The address of the signer.
    function recoverEip712Signer(
        bytes calldata encodedSignature,
        bytes32 orderDigest
    ) internal view returns (address owner) {
        (bytes32 r, bytes32 s, uint8 v) =
            decodeEcdsaSignature(encodedSignature);

        uint256 freeMemoryPointer = getFreeMemoryPointer();

        bytes32 signingDigest =
            keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, orderDigest)
            );

        owner = ecrecover(signingDigest, v, r, s);
        require(owner != address(0), "GPv2: invalid eip712 signature");

        setFreeMemoryPointer(freeMemoryPointer);
    }

    /// @dev Decodes signature bytes originating from the output of the eth_sign
    /// RPC call.
    ///
    /// The specifications are described in the Ethereum documentation
    /// (<https://eth.wiki/json-rpc/API#eth_sign>).
    ///
    /// eth_sign signatures are encoded as standard ECDSA signatures as
    /// described in the corresponding decoding function
    /// [`decodeEcdsaSignature`].
    ///
    /// Unused signature data is returned along with the address of the signer.
    /// If the signature is not valid, the function reverts.
    ///
    /// @param encodedSignature Calldata pointing to tightly packed signature
    /// bytes.
    /// @param orderDigest The EIP-712 signing digest derived from the order
    /// parameters.
    /// @return owner The address of the signer.
    function recoverEthsignSigner(
        bytes calldata encodedSignature,
        bytes32 orderDigest
    ) internal view returns (address owner) {
        (bytes32 r, bytes32 s, uint8 v) =
            decodeEcdsaSignature(encodedSignature);

        uint256 freeMemoryPointer = getFreeMemoryPointer();

        // The signed message is encoded as:
        // `"\x19Ethereum Signed Message:\n" || length || data`, where
        // the length is a constant (64 bytes) and the data is defined as:
        // `domainSeparator || orderDigest`.
        bytes32 signingDigest =
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n64",
                    domainSeparator,
                    orderDigest
                )
            );

        owner = ecrecover(signingDigest, v, r, s);
        require(owner != address(0), "GPv2: invalid ethsign signature");

        setFreeMemoryPointer(freeMemoryPointer);
    }

    /// @dev Verifies the input calldata as an EIP-1271 contract signature and
    /// returns the address of the signer.
    ///
    /// The encoded signature tightly packs the following struct:
    ///
    /// ```
    /// struct EncodedEip1271Signature {
    ///     address owner;
    ///     bytes signature;
    /// }
    /// ```
    ///
    /// This function enforces that the encoded data stores enough bytes to
    /// cover the full length of the decoded signature.
    function recoverEip1271Signer(
        bytes calldata encodedSignature,
        bytes32 orderDigest
    ) internal view returns (address owner) {
        // NOTE: Use assembly to read the verifier address from the encoded
        // signature bytes.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // owner = address(encodedSignature[0:20])
            owner := shr(96, calldataload(encodedSignature.offset))
        }

        // NOTE: Configure prettier to ignore the following line as it causes
        // a panic in the Solidity plugin.
        // prettier-ignore
        bytes calldata signature = encodedSignature[20:];

        uint256 freeMemoryPointer = getFreeMemoryPointer();

        // The digest is chosen to be consistent with EIP-191. Its format is:
        // 0x19 <1 byte version> <version specific data> <data to sign>.
        // Version number 0x2a is chosen arbitrarily so that it does not
        // overlaps already assigned version numbers.
        bytes32 signingDigest =
            keccak256(
                abi.encodePacked("\x19\x2a", domainSeparator, orderDigest)
            );

        setFreeMemoryPointer(freeMemoryPointer);

        require(
            EIP1271Verifier(owner).isValidSignature(signingDigest, signature) ==
                GPv2EIP1271.MAGICVALUE,
            "GPv2: invalid eip1271 signature"
        );
    }

    /// @dev Returns a pointer to the first location in memory that has not
    /// been allocated by the code at this point in the code.
    ///
    /// @return pointer A pointer to the first unallocated location in memory.
    function getFreeMemoryPointer() private pure returns (uint256 pointer) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            pointer := mload(0x40)
        }
    }

    /// @dev Manually sets the pointer that specifies the first location in
    /// memory that is available to be allocated. It allows to free unused
    /// allocated memory, but if used incorrectly it could lead to the same
    /// address in memory being used twice.
    ///
    /// This function exists to deallocate memory for operations that allocate
    /// memory during their execution but do not free it after use.
    /// Examples are:
    /// - calling the ABI encoding methods
    /// - calling the `ecrecover` precompile.
    /// If we reset the free memory pointer to what it was before the execution
    /// of these operations, we effectively deallocated the memory used by them.
    /// This is safe as the memory used can be discarded, and the memory pointed
    /// to by the free memory pointer **does not have to point to zero-ed out
    /// memory**.
    /// <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html>
    ///
    /// @param pointer A pointer to a location in memory.
    function setFreeMemoryPointer(uint256 pointer) private pure {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(0x40, pointer)
        }
    }
}
