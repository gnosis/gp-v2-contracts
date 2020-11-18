// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.6.12;

import "../GPv2Settlement.sol";

contract GPv2SettlementTestInterface is GPv2Settlement {
    constructor(GPv2SimpleAuthentication _controller)
        public
        GPv2Settlement(_controller)
    // solhint-disable-next-line no-empty-blocks
    {
        // According to the solidity docs:
        // https://docs.soliditylang.org/en/develop/contracts.html#arguments-for-base-constructors
        // This is how we inherit base constructors.
    }

    function domainSeparatorTest() public view returns (bytes32) {
        return domainSeparator;
    }
}
