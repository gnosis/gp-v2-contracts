// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.5;

import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(GPv2Authentication authenticator_)
        GPv2Settlement(authenticator_)
    // solhint-disable-next-line no-empty-blocks
    {

    }

    function domainSeparatorTest() public view returns (bytes32) {
        return domainSeparator;
    }
}
