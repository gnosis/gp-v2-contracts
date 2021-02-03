// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Signing.sol";
import "../libraries/GPv2Trade.sol";

contract GPv2SigningTestInterface {
    using GPv2Signing for GPv2Signing.RecoveredOrder;

    bytes32 public constant DOMAIN_SEPARATOR =
        keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name)"),
                keccak256("test")
            )
        );

    function recoverOrdersFromTradesTest(
        IERC20[] calldata tokens,
        GPv2Trade.Data[] calldata trades
    )
        external
        view
        returns (
            GPv2Signing.RecoveredOrder[] memory recoveredOrders,
            uint256 mem,
            uint256 gas_
        )
    {
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        recoveredOrders = new GPv2Signing.RecoveredOrder[](trades.length);
        for (uint256 i = 0; i < recoveredOrders.length; i++) {
            recoveredOrders[i].uid = new bytes(GPv2Order.UID_LENGTH);
        }

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding a trade to compute memory usage growth per
        // call to `decodeTrade`. Additionally, write 0 past the free memory
        // pointer so the size of `recoveredOrders` does not affect the gas
        // measurement.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
            mstore(mem, 0)
        }
        gas_ = gasleft();

        for (uint256 i = 0; i < recoveredOrders.length; i++) {
            recoveredOrders[i].recoverOrderFromTrade(
                domainSeparator,
                tokens,
                trades[i]
            );
        }

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();
    }
}
