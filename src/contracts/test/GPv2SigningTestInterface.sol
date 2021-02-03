// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Trade.sol";
import "../mixins/GPv2Signing.sol";

contract GPv2SigningTestInterface is GPv2Signing {
    function recoverOrderFromTradeTest(
        IERC20[] calldata tokens,
        GPv2Trade.Data calldata trade
    )
        external
        view
        returns (RecoveredOrder memory recoveredOrder, uint256 mem)
    {
        recoveredOrder = allocateRecoveredOrder();

        // NOTE: Solidity stores the free memory pointer at address 0x40. Read
        // it before and after calling `processOrder` to ensure that there are
        // no memory allocations.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
        }

        recoverOrderFromTrade(recoveredOrder, tokens, trade);

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
    }

    function recoverOrderSignerTest(
        GPv2Order.Data memory order,
        GPv2Signing.Scheme signingScheme,
        bytes calldata signature
    ) external view returns (address owner) {
        (, owner) = recoverOrderSigner(order, signingScheme, signature);
    }

    function orderSigningHashTest(GPv2Order.Data memory order)
        external
        view
        returns (bytes32 orderDigest)
    {
        orderDigest = orderSigningHash(order);
    }
}
