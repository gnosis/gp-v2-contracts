// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/// @title Gnosis Protocol v2 Trade Execution
/// @author Gnosis Developers
library GPv2TradeExecutionWithErrorMsg {
    using SafeERC20 for IERC20;

    /// @dev Ether marker address used to indicate an order is buying Ether.
    address internal constant BUY_ETH_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @dev Executed trade data.
    struct Data {
        address owner;
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
    }

    /// @dev Executes the trade's sell amount, transferring it from the trade's
    /// owner to the specified recipient.
    function transferSellAmountToRecipient(
        Data calldata trade,
        address recipient
    ) internal {
        trade.sellToken.safeTransferFrom(
            trade.owner,
            recipient,
            trade.sellAmount
        );
    }

    /// @dev Executes the trade's buy amount, transferring it to the trade's
    /// owner from the caller's address.
    function transferBuyAmountToOwner(Data memory trade) internal {
        if (address(trade.buyToken) == BUY_ETH_ADDRESS) {
            payable(trade.owner).transfer(trade.buyAmount);
        } else {
            string memory errMsg =
                toString(
                    abi.encodePacked(
                        "buffer of token ",
                        trade.buyToken,
                        "not sufficient"
                    )
                );
            require(
                trade.buyToken.balanceOf(address(this)) > trade.buyAmount,
                errMsg
            );
            trade.buyToken.safeTransfer(trade.owner, trade.buyAmount);
        }
    }

    function toString(bytes memory data) public pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";

        bytes memory str = new bytes(2 + data.length * 2);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < data.length; i++) {
            str[2 + i * 2] = alphabet[uint256(uint8(data[i] >> 4))];
            str[3 + i * 2] = alphabet[uint256(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }
}
