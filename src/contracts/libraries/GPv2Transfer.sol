// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../interfaces/IERC20.sol";
import "../interfaces/IVault.sol";
import "./GPv2SafeERC20.sol";

/// @title Gnosis Protocol v2 Transfers
/// @author Gnosis Developers
library GPv2Transfer {
    using GPv2SafeERC20 for IERC20;

    /// @dev Transfer data.
    struct Data {
        address account;
        IERC20 token;
        uint256 amount;
        bool useInternalBalance;
    }

    /// @dev Ether marker address used to indicate an Ether transfer.
    address internal constant BUY_ETH_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @dev Execute the specified transfers from the specified accounts to a
    /// single recipient.
    ///
    /// This method is used for accumulating user balances into the settlement
    /// contract.
    ///
    /// @param vault The Balancer vault to use.
    /// @param recipient The single recipient for all the transfers.
    /// @param transfers The batched transfers to perform.
    function transferToRecipient(
        IVault vault,
        address recipient,
        Data[] calldata transfers
    ) internal {
        // NOTE: Pre-allocate an array of vault balance tranfers large enough to
        // hold all transfers. This allows us to efficiently batch internal
        // balance transfers into a single Vault call.
        IVault.BalanceTransfer[] memory vaultTransfers =
            new IVault.BalanceTransfer[](transfers.length);
        uint256 vaultTransferCount = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            Data calldata transfer = transfers[i];
            require(
                address(transfer.token) != BUY_ETH_ADDRESS,
                "GPv2: cannot transfer native ETH"
            );

            if (transfer.useInternalBalance) {
                IVault.BalanceTransfer memory vaultTransfer =
                    vaultTransfers[vaultTransferCount++];
                vaultTransfer.token = transfer.token;
                vaultTransfer.amount = transfer.amount;
                vaultTransfer.sender = transfer.account;
                vaultTransfer.recipient = recipient;
            } else {
                transfer.token.safeTransferFrom(
                    transfer.account,
                    recipient,
                    transfer.amount
                );
            }
        }

        if (vaultTransferCount > 0) {
            truncateTransfersArray(vaultTransfers, vaultTransferCount);
            vault.withdrawFromInternalBalance(vaultTransfers);
        }
    }

    /// @dev Execute the specified transfers to their respective accounts.
    ///
    /// This method is used for paying out trade proceeds from the settlement
    /// contract.
    ///
    /// @param vault The Balancer vault to use.
    /// @param transfers The batched transfers to perform.
    function transferToAccounts(IVault vault, Data[] memory transfers)
        internal
    {
        IVault.BalanceTransfer[] memory vaultTransfers =
            new IVault.BalanceTransfer[](transfers.length);
        uint256 vaultTransferCount = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            Data memory transfer = transfers[i];

            if (address(transfer.token) == BUY_ETH_ADDRESS) {
                require(
                    !transfer.useInternalBalance,
                    "GPv2: unsupported internal ETH"
                );
                payable(transfer.account).transfer(transfer.amount);
            } else if (transfer.useInternalBalance) {
                IVault.BalanceTransfer memory vaultTransfer =
                    vaultTransfers[vaultTransferCount++];
                vaultTransfer.token = transfer.token;
                vaultTransfer.amount = transfer.amount;
                vaultTransfer.sender = address(this);
                vaultTransfer.recipient = transfer.account;
            } else {
                transfer.token.safeTransfer(transfer.account, transfer.amount);
            }
        }

        if (vaultTransferCount > 0) {
            truncateTransfersArray(vaultTransfers, vaultTransferCount);
            vault.depositToInternalBalance(vaultTransfers);
        }
    }

    /// @dev Truncate a Vault balance transfer array to its actual size.
    ///
    /// This method **does not** check whether or not the new length is valid,
    /// and specifying a size that is larger than the array's actual length is
    /// undefined behaviour.
    ///
    /// @param vaultTransfers The memory array of vault transfers to truncate.
    /// @param length The new length to set.
    function truncateTransfersArray(
        IVault.BalanceTransfer[] memory vaultTransfers,
        uint256 length
    ) private pure {
        // NOTE: Truncate the vault transfers array to the specified length.
        // This is done by setting the array's length which occupies the first
        // word in memory pointed to by the `vaultTransfers` memory variable.
        // <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mstore(vaultTransfers, length)
        }
    }
}
