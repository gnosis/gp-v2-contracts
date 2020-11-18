// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.6.12;

import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(GPv2SimpleAuthentication _controller)
        public
        GPv2Settlement(_controller)
    // solhint-disable-next-line no-empty-blocks
    {
    }

    function domainSeparatorTest() public view returns (bytes32) {
        return domainSeparator;
    }
}
