// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../libraries/GPv2Encoding.sol";

contract GPv2EncodingTestInterface {
    bytes32 public constant DOMAIN_SEPARATOR =
        keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name)"),
                keccak256("test")
            )
        );

    function orderTypeHashTest() external pure returns (bytes32) {
        return (GPv2Encoding.ORDER_TYPE_HASH);
    }

    function decodeSignedOrdersTest(
        IERC20[] calldata tokens,
        uint256 orderCount,
        bytes calldata encodedOrders
    )
        external
        view
        returns (
            GPv2Encoding.Order[] memory orders,
            uint256 mem,
            uint256 gas_
        )
    {
        // solhint-disable no-inline-assembly

        uint256 stride = GPv2Encoding.ORDER_STRIDE;
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        orders = new GPv2Encoding.Order[](orderCount);

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding an order to compute memory usage growth per
        // call to `decodeSignedOrder`.
        assembly {
            mem := mload(0x40)
        }
        gas_ = gasleft();

        uint256 start;
        bytes calldata encodedOrder;
        for (uint256 i = 0; i < orderCount; i++) {
            start = i * stride;
            if (i == orderCount - 1) {
                // NOTE: Last order uses all remaining bytes. This allows the
                // `decodeSignedOrder` method to be tested with short and long
                // order bytes as well.
                encodedOrder = encodedOrders[start:];
            } else {
                encodedOrder = encodedOrders[start:][:stride];
            }

            GPv2Encoding.decodeSignedOrder(
                domainSeparator,
                tokens,
                encodedOrder,
                orders[i]
            );
        }

        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();

        // solhint-enable
    }
}
