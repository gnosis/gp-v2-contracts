// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity >=0.6.0 <0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title GPv2SafeERC20
 * @author Gnosis Developers
 * @dev Gas-efficient version of Openzeppelin's SafeERC20 contract that does not
 * revert when calling a non-contract.
 */
library GPv2SafeERC20 {
    /**
     * @dev Wrapper around a call to the ERC20 function `transfer` that reverts
     * also when the token returns `false`.
     */
    function safeTransfer(
        IERC20 token,
        address to,
        uint256 value
    ) internal {
        _callOptionalReturn(
            token,
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
    }

    /**
     * @dev Wrapper around a call to the ERC20 function `transferFrom` that
     * reverts also when the token returns `false`.
     */
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 value
    ) internal {
        _callOptionalReturn(
            token,
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
    }

    /**
     * @dev A reimplementation of the function with the same name in
     * Openzeppelin's SafeERC20. Unlike Openzeppelin's implementation, this
     * function does not revert if an address without code is called.
     *
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = address(token).call(data);

        if (!success) {
            // Assembly used to revert with correctly encoded error message.
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }
        if (returndata.length > 0) {
            // Return data is optional
            require(
                abi.decode(returndata, (bool)),
                "GPv2SafeERC20: failed transfer"
            );
        }
    }
}
