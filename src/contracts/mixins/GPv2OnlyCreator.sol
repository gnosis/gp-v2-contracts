// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

/// @title Gnosis Protocol v2 Creator Access Control Contract
/// @author Gnosis Developers
abstract contract GPv2OnlyCreator {
    /// @dev The creator of the contract which has special permissions. This
    /// value is set at creation time and cannot change.
    address private immutable creator;

    constructor() {
        creator = msg.sender;
    }

    /// @dev Modifier that ensures that a function can only be called by the
    /// creator of this contract.
    modifier onlyCreator {
        require(msg.sender == creator, "GPv2: not creator");
        _;
    }
}
