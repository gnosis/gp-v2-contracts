// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "./interfaces/IVault.sol";
import "./mixins/GPv2OnlyCreator.sol";

/// @title Gnosis Protocol v2 Vault Relayer Contract
/// @author Gnosis Developers
contract GPv2VaultRelayer is GPv2OnlyCreator {
    /// @dev The vault this relayer is for.
    IVault private immutable vault;

    constructor(IVault vault_) {
        vault = vault_;
    }

    // NOTE: Add a unused external method so that the compiler doesn't optimize
    // away the two immutables so we can read them for unit tests. Once this
    // contract actually does something, this can be removed.
    function unused() external view onlyCreator returns (bytes32 random) {
        random = keccak256(abi.encodePacked(vault));
    }
}
