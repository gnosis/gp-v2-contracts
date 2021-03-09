// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IVault.sol";
import "./libraries/GPv2TradeExecution.sol";

/// @title Gnosis Protocol v2 Vault Relayer Contract
/// @author Gnosis Developers
contract GPv2VaultRelayer {
    using GPv2TradeExecution for GPv2TradeExecution.Data;

    /// @dev The creator of the contract which has special permissions. This
    /// value is set at creation time and cannot change.
    address private immutable creator;

    /// @dev The vault this relayer is for.
    IVault private immutable vault;

    constructor(IVault vault_) {
        creator = msg.sender;
        vault = vault_;
    }

    /// @dev Modifier that ensures that a function can only be called by the
    /// creator of this contract.
    modifier onlyCreator {
        require(msg.sender == creator, "GPv2: not creator");
        _;
    }

    /// @dev Transfers all sell amounts for the executed trades from their
    /// owners to the caller.
    ///
    /// This function reverts if:
    /// - The caller is not the creator of the vault relayer
    /// - Any ERC20 transfer fails
    ///
    /// @param trades The executed trades whose sell amounts need to be
    /// transferred in.
    function transferIn(GPv2TradeExecution.Data[] calldata trades)
        external
        onlyCreator
    {
        for (uint256 i = 0; i < trades.length; i++) {
            GPv2TradeExecution.transferSellAmountToRecipient(
                trades[i],
                msg.sender
            );
        }
    }

    // NOTE: Add a unused external method so that the compiler doesn't optimize
    // away the `vault` immutable so we can read them for unit testing. Once
    // this contract actually does something, this can be removed.
    function unused() external view returns (bytes32 random) {
        random = keccak256(abi.encodePacked(vault));
    }
}
