// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

    /// @dev Execute the specified transfer from the specified account to a
    /// recipient. The recipient will either receive internal Vault balances or
    /// ERC20 token balances depending on whether the account is using internal
    /// balances or not.
    ///
    /// This method is used for transferring fees to the settlement contract
    /// when settling a single order directly with Balancer.
    ///
    /// @param vault The Balancer vault to use.
    /// @param transfer The transfer to perform specifying the sender account.
    /// @param recipient The recipient for the transfer.
    function transferFromAccount(
        IVault vault,
        Data calldata transfer,
        address recipient
    ) internal {
        require(
            address(transfer.token) != BUY_ETH_ADDRESS,
            "GPv2: cannot transfer native ETH"
        );

        IVault.BalanceTransfer[] memory vaultTransfers =
            new IVault.BalanceTransfer[](1);

        IVault.BalanceTransfer memory vaultTransfer = vaultTransfers[0];
        vaultTransfer.token = transfer.token;
        vaultTransfer.amount = transfer.amount;
        vaultTransfer.sender = transfer.account;
        vaultTransfer.recipient = recipient;

        if (transfer.useInternalBalance) {
            vault.transferInternalBalance(vaultTransfers);
        } else {
            vault.transferToExternalBalance(vaultTransfers);
        }
    }

    /// @dev Execute the specified transfers from the specified accounts to a
    /// single recipient. The recipient will receive all transfers as ERC20
    /// token balances, regardless of whether or not the accounts are using
    /// internal Vault balances.
    ///
    /// This method is used for accumulating user balances into the settlement
    /// contract.
    ///
    /// @param vault The Balancer vault to use.
    /// @param transfers The batched transfers to perform specifying the
    /// sender accounts.
    /// @param recipient The single recipient for all the transfers.
    function transferFromAccounts(
        IVault vault,
        Data[] calldata transfers,
        address recipient
    ) internal {
        uint256 transferCount = transfers.length;

        // NOTE: Allocate an array of Vault balance transfers large enough
        // to hold all transfers plus an extra slot used for splitting.
        // Withdrawals are appended from the start of the array, while external
        // transfers are added to the end. This buffer gets split into two
        // memory arrays, using the extra slot that was allocated to hold the
        // length of the second array. This allows us to efficiently batch
        // transfers into at most two Vault calls.
        IVault.BalanceTransfer[] memory vaultTransfers =
            new IVault.BalanceTransfer[](transferCount + 1);
        uint256 withdrawCount = 0;
        uint256 externalTransferCount = 0;

        for (uint256 i = 0; i < transferCount; i++) {
            Data calldata transfer = transfers[i];
            require(
                address(transfer.token) != BUY_ETH_ADDRESS,
                "GPv2: cannot transfer native ETH"
            );

            IVault.BalanceTransfer memory vaultTransfer =
                transfer.useInternalBalance
                    ? vaultTransfers[withdrawCount++]
                    : vaultTransfers[transferCount - (externalTransferCount++)];

            vaultTransfer.token = transfer.token;
            vaultTransfer.amount = transfer.amount;
            vaultTransfer.sender = transfer.account;
            vaultTransfer.recipient = recipient;
        }

        // NOTE: At this point, our Vault balance transfers array looks like
        // the following in memory:
        // ```
        // offset |   0   |   1   |       |   N   |  N+1  |  N+2  |       |  N+M
        // -------+-------+-------+  ...  +-------+-------+-------+  ...  +-------
        //  value | N+M+1 |  wdl0 |       |  wdlN |   -   | xferM |       | xfer0
        // ```
        // In order to split the memory array, we need to update two memory
        // slots, the first slot so that it reflects the length of withdrawals,
        // as well as the (N+1)th slot, so that it reflects the length of the
        // external transfers.
        // <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html>
        IVault.BalanceTransfer[] memory withdrawals;
        IVault.BalanceTransfer[] memory externalTransfers;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            withdrawals := vaultTransfers
            mstore(withdrawals, withdrawCount)
            externalTransfers := add(
                vaultTransfers,
                mul(add(withdrawCount, 1), 0x20)
            )
            mstore(externalTransfers, externalTransferCount)
        }

        if (withdrawCount > 0) {
            vault.withdrawFromInternalBalance(withdrawals);
        }
        if (externalTransferCount > 0) {
            vault.transferToExternalBalance(externalTransfers);
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
        // NOTE: Allocate a buffer of Vault balance transfers large enough to
        // hold all transfers, even if not all of them use internal balances.
        // This is done to avoid re-allocations (which are gas inefficient)
        // while still allowing all deposits to be batched into a single Vault
        // call.
        IVault.BalanceTransfer[] memory deposits =
            new IVault.BalanceTransfer[](transfers.length);
        uint256 depositCount = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            Data memory transfer = transfers[i];

            if (address(transfer.token) == BUY_ETH_ADDRESS) {
                require(
                    !transfer.useInternalBalance,
                    "GPv2: unsupported internal ETH"
                );
                payable(transfer.account).transfer(transfer.amount);
            } else if (transfer.useInternalBalance) {
                IVault.BalanceTransfer memory deposit =
                    deposits[depositCount++];
                deposit.token = transfer.token;
                deposit.amount = transfer.amount;
                deposit.sender = address(this);
                deposit.recipient = transfer.account;
            } else {
                transfer.token.safeTransfer(transfer.account, transfer.amount);
            }
        }

        if (depositCount > 0) {
            // NOTE: Truncate the vault transfers array to the specified length.
            // This is done by setting the array's length which occupies the
            // first word in memory pointed to by the `deposits` variable.
            // <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html>
            // solhint-disable-next-line no-inline-assembly
            assembly {
                mstore(deposits, depositCount)
            }
            vault.depositToInternalBalance(deposits);
        }
    }
}
