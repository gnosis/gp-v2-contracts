// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Transfer.sol";

contract GPv2TransferTestInterface {
    function transferToRecipientTest(
        IVault vault,
        address recipient,
        GPv2Transfer.Data[] calldata transfers
    ) external {
        GPv2Transfer.transferToRecipient(vault, recipient, transfers);
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}
}
