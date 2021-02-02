// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Signing.sol";
import "../libraries/GPv2Trade.sol";

contract GPv2SigningTestInterface {
    using GPv2Signing for GPv2Order.Data;
    using GPv2Signing for GPv2Signing.RecoveredOrder;

    bytes32 public constant DOMAIN_SEPARATOR =
        keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name)"),
                keccak256("test")
            )
        );

    function recoverOrderFromTradeTest(
        IERC20[] calldata tokens,
        GPv2Trade.Data calldata trade
    ) external view returns (GPv2Signing.RecoveredOrder memory recoveredOrder) {
        recoveredOrder = GPv2Signing.allocateRecoveredOrder();
        recoveredOrder.recoverOrderFromTrade(DOMAIN_SEPARATOR, tokens, trade);
    }

    function recoverOrderSignerTest(
        GPv2Order.Data memory order,
        GPv2Signing.Scheme signingScheme,
        bytes calldata signature
    ) external view returns (address owner) {
        (, owner) = order.recoverOrderSigner(
            DOMAIN_SEPARATOR,
            signingScheme,
            signature
        );
    }
}
