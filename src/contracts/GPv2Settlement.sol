// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Gnosis Protocol v2 Settlement Contract
/// @author Gnosis Developers
contract GPv2Settlement {
    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible. This domain
    /// separator is computed following the EIP-712 standard and has replay
    /// protection mixed in so that signed orders are only valid for specific
    /// GPv2 contracts.
    bytes32 internal immutable domainSeparator;

    constructor() public {
        uint256 chainId;

        // NOTE: Currently, the only way to get the chain ID in solidity is
        // using assembly.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Gnosis Protocol"),
                keccak256("v2"),
                chainId,
                address(this)
            )
        );
    }

    /// @dev Settle the specified orders at a clearing price. Note that it is
    /// the responsibility of the caller to ensure that all GPv2 invariants are
    /// upheld for the input settlement, otherwise this call will revert.
    /// Namely:
    /// - The fee factor cannot lead to fees > 0.1%
    /// - All orders are valid and signed
    /// - Accounts have sufficient balance and approval.
    /// - Settlement contract has sufficient balance to execute trades. Note
    ///   this implies that the accumulated fees held in the contract can also
    ///   be used for settlement. This is OK since:
    ///   - Solvers need to be authorized
    ///   - Misbehaving solvers will be slashed for abusing accumulated fees for
    ///     settlement
    ///   - Critically, user orders are entirely protected
    ///
    /// Note that settlements can specify fees encoded as a fee factor.  The fee
    /// factor to use for the trade. The actual fee is computed as
    /// `1 / feeFactor`. This means that the received amount is expected to be
    /// `executedBuyAmount * (feeFactor - 1) / feeFactor`. Note that a value of
    /// `0` is reserved to mean no fees. This is useful for example when
    /// settling directly with Uniswap where we don't want users to incur
    /// additional fees.
    ///
    /// Note that some parameters are encoded as packed bytes in order to save
    /// calldata gas. For more information on encoding format consult the
    /// [`GPv2Encoding`] library.
    ///
    /// @param tokens An array of ERC20 tokens to be traded in the settlement.
    /// Orders and interactions encode tokens as indices into this array.
    /// @param clearingPrices An array of clearing prices where the `i`-th price
    /// is for the `i`-th token in the [`tokens`] array.
    /// @param feeFactor The fee factor to use for the trade.
    /// @param encodedOrders Encoded signed EOA orders.
    /// @param encodedInteractions Encoded smart contract interactions.
    /// @param encodedOrderRefunds Encoded order refunds for clearing storage
    /// related to invalid orders.
    function settle(
        IERC20[] calldata tokens,
        uint256[] calldata clearingPrices,
        uint256 feeFactor,
        bytes calldata encodedOrders,
        bytes calldata encodedInteractions,
        bytes calldata encodedOrderRefunds
    ) external pure {
        require(tokens.length == 0, "not yet implemented");
        require(clearingPrices.length == 0, "not yet implemented");
        require(feeFactor == 0, "not yet implemented");
        require(encodedOrders.length == 0, "not yet implemented");
        require(encodedInteractions.length == 0, "not yet implemented");
        require(encodedOrderRefunds.length == 0, "not yet implemented");
        revert("not yet implemented");
    }
}
