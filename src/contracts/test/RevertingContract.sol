// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

contract RevertingContract {
    fallback() external payable {
        revert("I always revert!");
    }
}
