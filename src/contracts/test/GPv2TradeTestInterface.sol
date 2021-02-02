// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../libraries/GPv2Order.sol";
import "../libraries/GPv2Trade.sol";

contract GPv2TradeTestInterface {
    using GPv2Trade for GPv2Trade.Recovered;

    bytes32 public constant DOMAIN_SEPARATOR =
        keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name)"),
                keccak256("test")
            )
        );

    function recoverTradesTest(
        IERC20[] calldata tokens,
        GPv2Trade.Data[] calldata inputTrades
    )
        external
        view
        returns (
            GPv2Trade.Recovered[] memory trades,
            uint256 mem,
            uint256 gas_
        )
    {
        bytes32 domainSeparator = DOMAIN_SEPARATOR;

        trades = new GPv2Trade.Recovered[](inputTrades.length);
        for (uint256 i = 0; i < trades.length; i++) {
            trades[i].orderUid = new bytes(GPv2Order.UID_LENGTH);
        }

        // NOTE: Solidity keeps a total memory count at address 0x40. Check
        // before and after decoding a trade to compute memory usage growth per
        // call to `decodeTrade`. Additionally, write 0 past the free memory
        // pointer so the size of `trades` does not affect the gas measurement.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := mload(0x40)
            mstore(mem, 0)
        }
        gas_ = gasleft();

        for (uint256 i = 0; i < trades.length; i++) {
            trades[i].recoverTrade(domainSeparator, tokens, inputTrades[i]);
        }

        // solhint-disable-next-line no-inline-assembly
        assembly {
            mem := sub(mload(0x40), mem)
        }
        gas_ = gas_ - gasleft();
    }

    function extractOrder(
        IERC20[] calldata tokens,
        GPv2Trade.Data calldata trade
    ) external pure returns (GPv2Order.Data memory order) {
        GPv2Trade.extractOrder(trade, tokens, order);
    }

    function extractFlagsTest(uint256 flags)
        external
        pure
        returns (
            bytes32 kind,
            bool partiallyFillable,
            GPv2Signing.Scheme signingScheme
        )
    {
        return GPv2Trade.extractFlags(flags);
    }
}
