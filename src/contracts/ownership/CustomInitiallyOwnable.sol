// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Ownable contract with custom intial owner
 * @author Gnosis Developers
 * @dev A contract extending Openzeppelin's Ownable contract that allows to
 * specify the initial owner in the contructor instead of using the message
 * sender.
 */
abstract contract CustomInitiallyOwnable is Ownable {
    /**
     * @dev Initializes the contract setting the input address as the initial
     * owner.
     */
    constructor(address initialOwner) {
        transferOwnership(initialOwner);
    }
}
