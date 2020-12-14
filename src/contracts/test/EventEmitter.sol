// SPDX-License-Identifier: LGPL-3.0
pragma solidity ^0.7.5;

contract EventEmitter {
    event Event(uint256 number);

    function emitEvent(uint256 number) external {
        emit Event(number);
    }
}
