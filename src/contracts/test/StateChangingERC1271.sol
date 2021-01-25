// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "../interfaces/GPv2EIP1271.sol";

/// @dev This contract implements the standard described in EIP-1271 with the
/// minor change that the verification function changes the state. This is
/// forbidden by the standard specifications.
contract StateChangingEIP1271 {
    uint256 public state = 0;

    // solhint-disable-next-line no-unused-vars
    function isValidSignature(bytes32 _hash, bytes memory _signature)
        public
        returns (bytes4 magicValue)
    {
        state += 1;
        magicValue = GPv2EIP1271.MAGICVALUE;
    }
}
