// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "../GPv2Settlement.sol";

/// @title Gnosis Protocol v2 Trade Simulator
/// @author Gnosis Developers
contract GPv2TradeSimulator {
    using GPv2Transfer for IVault;
    using SafeCast for int256;
    using SafeCast for uint256;

    /// @dev A trade to simulate.
    struct Trade {
        address owner;
        address receiver;
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        bytes32 sellTokenBalance;
        bytes32 buyTokenBalance;
    }

    /// @dev Sentinal value to indicate that the buy amount for the trade's out
    /// transfer should use all received buy tokens from the interactions
    /// specified for the simulation.
    uint256 private constant USE_ALL_RECEIVED_BUY_TOKENS = 0;

    /// @dev Initial token state used internally for computing balance changes.
    struct TokenState {
        IERC20 token;
        uint256 initialBalance;
    }

    /// @dev Simulation context.
    struct Context {
        GPv2Transfer.Data[] inTransfers;
        GPv2Transfer.Data[] outTransfers;
        TokenState sellTokenState;
        TokenState buyTokenState;
    }

    /// @dev Simulates a user trade.
    ///
    /// This method can be used to determine whether or not a token is supported
    /// as well as getting a rough estimate on how much gas is required to
    /// execute the trade given a set of interactions.
    ///
    /// One notable difference, is the simulation doesn't actually require an
    /// order. This makes using this method inaccurate for predicting gas usage
    /// for specific trades. However, seeing as computing trade executions is
    /// completely independant of external contracts (i.e. it does not depend on
    /// the tokens being traded or the interactions being executed) the gas
    /// consumption should be off by a predicatable amount.
    ///
    /// @param trade The trade to simulate.
    /// @param interactions A set of interactions to settle the trade against.
    function simulateTrade(
        Trade calldata trade,
        GPv2Interaction.Data[] calldata interactions
    ) external returns (int256 sellDelta, int256 buyDelta) {
        GPv2Settlement self = GPv2Settlement(payable(address(this)));
        Context memory context = createContext(trade);

        self.vaultRelayer().transferFromAccounts(context.inTransfers);

        for (uint256 i; i < interactions.length; i++) {
            GPv2Interaction.execute(interactions[i]);
        }

        updateOutTransferAmount(context);
        self.vault().transferToAccounts(context.outTransfers);

        sellDelta = computeBalanceDelta(context.sellTokenState);
        buyDelta = computeBalanceDelta(context.buyTokenState);
    }

    /// @dev Initializes a simulation context in memory for the current trade
    /// simulation.
    ///
    /// This helps organize simulation data and work around "stack too deep"
    /// Solidity errors.
    function createContext(Trade calldata trade)
        private
        view
        returns (Context memory context)
    {
        context.inTransfers = new GPv2Transfer.Data[](1);
        context.inTransfers[0].account = trade.owner;
        context.inTransfers[0].token = trade.sellToken;
        context.inTransfers[0].amount = trade.sellAmount;
        context.inTransfers[0].balance = trade.sellTokenBalance;

        context.outTransfers = new GPv2Transfer.Data[](1);
        context.outTransfers[0].account = trade.receiver ==
            GPv2Order.RECEIVER_SAME_AS_OWNER
            ? trade.owner
            : trade.receiver;
        context.outTransfers[0].token = trade.buyToken;
        context.outTransfers[0].amount = trade.buyAmount;
        context.outTransfers[0].balance = trade.buyTokenBalance;

        context.sellTokenState.token = trade.sellToken;
        context.sellTokenState.initialBalance = trade.sellToken.balanceOf(
            address(this)
        );

        context.buyTokenState.token = trade.buyToken;
        context.buyTokenState.initialBalance = trade.buyToken.balanceOf(
            address(this)
        );
    }

    /// @dev Updates the out transfer token amount to be the exact amount of buy
    /// token that has been received so far. This allows buy amounts to be
    /// omitted from the trade simulation using a special sential value.
    function updateOutTransferAmount(Context memory context) private view {
        if (context.outTransfers[0].amount == USE_ALL_RECEIVED_BUY_TOKENS) {
            context.outTransfers[0].amount ==
                computeBalanceDelta(context.buyTokenState).toUint256();
        }
    }

    function computeBalanceDelta(TokenState memory state)
        private
        view
        returns (int256)
    {
        uint256 currentBalance = state.token.balanceOf(address(this));
        return currentBalance.toInt256() - state.initialBalance.toInt256();
    }
}
