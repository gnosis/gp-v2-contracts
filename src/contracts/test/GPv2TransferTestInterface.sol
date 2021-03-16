// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Transfer.sol";

contract GPv2TransferTestInterface {
    function transferFromAccountTest(
        IVault vault,
        address recipient,
        GPv2Transfer.Data calldata transfer
    ) external {
        GPv2Transfer.transferFromAccount(vault, recipient, transfer);
    }

    function transferFromAccountsTest(
        IVault vault,
        address recipient,
        GPv2Transfer.Data[] calldata transfers
    ) external {
        GPv2Transfer.transferFromAccounts(vault, recipient, transfers);
    }

    function transferToAccountsTest(
        IVault vault,
        GPv2Transfer.Data[] memory transfers
    ) external {
        GPv2Transfer.transferToAccounts(vault, transfers);
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}
}
