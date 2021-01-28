// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Order Library
/// @author Gnosis Developers
library GPv2Order {
    /// @dev Extracts specific order information from the standardized unique
    /// order id of the protocol.
    ///
    /// @param orderUid The unique identifier used to represent an order in
    /// the protocol. This uid is the packed concatenation of the order digest,
    /// the validTo order parameter and the address of the user who created the
    /// order. It is used by the user to interface with the contract directly,
    /// and not by calls that are triggered by the solvers.
    /// @return orderDigest The EIP-712 signing digest derived from the order
    /// parameters.
    /// @return owner The address of the user who owns this order.
    /// @return validTo The epoch time at which the order will stop being valid.
    function extractOrderUidParams(bytes calldata orderUid)
        internal
        pure
        returns (
            bytes32 orderDigest,
            address owner,
            uint32 validTo
        )
    {
        require(orderUid.length == 32 + 20 + 4, "GPv2: invalid uid");
        // Use assembly to efficiently decode packed calldata.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            orderDigest := calldataload(orderUid.offset)
            owner := shr(96, calldataload(add(orderUid.offset, 32)))
            validTo := shr(224, calldataload(add(orderUid.offset, 52)))
        }
    }
}
