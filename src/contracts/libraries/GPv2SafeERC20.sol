// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title GPv2SafeERC20
/// @author Gnosis Developers
/// @dev Gas-efficient version of Openzeppelin's SafeERC20 contract that does
/// not revert when calling a non-contract.
library GPv2SafeERC20 {
    /// @dev Wrapper around a call to the ERC20 function `transfer` that reverts
    /// also when the token returns `false`.
    function safeTransfer(
        IERC20 token,
        address to,
        uint256 value
    ) internal {
        bytes4 selector_ = token.transfer.selector;

        // solhint-disable-next-line no-inline-assembly
        bool success;
        assembly {
            let freeMemoryPointer := mload(0x40)
            mstore(freeMemoryPointer, selector_)
            mstore(add(freeMemoryPointer, 4), to)
            mstore(add(freeMemoryPointer, 36), value)

            if iszero(call(gas(), token, 0, freeMemoryPointer, 68, 0, 0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            switch returndatasize()
                case 0 {
                    success := 1
                }
                case 32 {
                    returndatacopy(0, 0, returndatasize())
                    success := mload(0)
                    if gt(success, 1) {
                        revert(0, 0)
                    }
                }
                default {
                    revert(0, 0)
                }
        }

        require(success, "GPv2SafeERC20: failed transfer");
    }

    /// @dev Wrapper around a call to the ERC20 function `transferFrom` that
    /// reverts also when the token returns `false`.
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value
    ) internal {
        bytes4 selector_ = token.transferFrom.selector;

        // solhint-disable-next-line no-inline-assembly
        bool success;
        assembly {
            let freeMemoryPointer := mload(0x40)
            mstore(freeMemoryPointer, selector_)
            mstore(add(freeMemoryPointer, 4), from)
            mstore(add(freeMemoryPointer, 36), to)
            mstore(add(freeMemoryPointer, 68), value)

            if iszero(call(gas(), token, 0, freeMemoryPointer, 100, 0, 0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            switch returndatasize()
                case 0 {
                    success := 1
                }
                case 32 {
                    returndatacopy(0, 0, returndatasize())
                    success := mload(0)
                    if gt(success, 1) {
                        revert(0, 0)
                    }
                }
                default {
                    revert(0, 0)
                }
        }

        require(success, "GPv2SafeERC20: failed transfer");
    }
}
