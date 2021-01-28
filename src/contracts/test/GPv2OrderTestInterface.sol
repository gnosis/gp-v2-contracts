// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Order.sol";

contract GPv2OrderTestInterface {
    using GPv2Order for bytes;

    function extractOrderUidParamsTest(bytes calldata orderUid)
        external
        pure
        returns (
            bytes32 orderDigest,
            address owner,
            uint32 validTo
        )
    {
        return orderUid.extractOrderUidParams();
    }
}
