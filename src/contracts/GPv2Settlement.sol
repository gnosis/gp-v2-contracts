// SPDX-license-identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

/// @title Gnosis Protocol v2 Settlement Contract
/// @author Gnosis Developers
contract GPv2Settlement {
    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible.
    bytes32 public constant DOMAIN_SEPARATOR = keccak256("GPv2");

    /// @dev The stride of an encoded order.
    uint256 private constant ORDER_STRIDE = 130;

    /// @dev The Uniswap factory. This is used as the AMM that GPv2 settles with
    /// and is responsible for determining the range of the settlement price as
    /// well as trading surplus that cannot be directly settled in a batch.
    IUniswapV2Factory public immutable uniswapFactory;

    /// @dev A mapping from a token pair ID to a nonce. This represents the
    /// batch for token pair and is used to ensure orders can't be replayed
    /// in multiple batches.
    mapping(bytes20 => uint256) public nonce;

    /// @param uniswapFactory_ The Uniswap factory to act as the AMM for this
    /// GPv2 settlement contract.
    constructor(IUniswapV2Factory uniswapFactory_) public {
        uniswapFactory = uniswapFactory_;
    }

    /// @dev Settle the specified orders at a clearing price. Note that it is
    /// the responsibility of the caller to ensure that all GPv2 invariants are
    /// upheld for the input settlement, otherwise this call will revert.
    /// Namely:
    /// - The prices are better than, or equal to, the AMM's price with its fee
    ///   spread. Specifically the price is either:
    ///   - Effective price in case the AMM was traded with,
    ///   - Spot price in case the AMM was not traded with.
    /// - All orders are valid and signed
    /// - Accounts have sufficient balance and approval.
    ///
    /// Note that orders in this method are expressed as encoded bytes. These
    /// bytes are tightly packed orders encoded with `abi.encodePacked` in order
    /// to reduce the amount of call data required to call this method. Orders
    /// encode the following fields:
    /// ```
    /// struct Order {
    ///     sellAmount:     uint112,
    ///     buyAmount:      uint112,
    ///     executedAmount: uint112,
    ///     tip:            uint112,
    ///     nonce:          uint32,
    ///     validTo:        uint32,
    ///     flags:          uint8,
    ///     signature: {
    ///         v:          uint8,
    ///         r:          bytes32,
    ///         s:          bytes32,
    ///     }
    /// }
    /// ```
    ///
    /// Note that the encoded order data does not contain which token is the
    /// sell or buy token. This data is implicit from which parameter the order
    /// was specified from.
    ///
    /// @param token0 The address of token 0 being traded in the batch.
    /// @param token1 The address of token 1 being traded in the batch.
    /// @param d0 The amount of token 0 being traded to the AMM.
    /// @param d1 The amount of token 1 being traded to the AMM.
    /// @param clearingPrice0 The price of token 0 expressed in arbitrary units.
    /// Note the exchange rate between token 0 and token 1 is `price1 / price0`.
    /// @param clearingPrice1 The price of token 1 expressed in arbitrary units.
    /// Note the exchange rate between token 1 and token 0 is `price0 / price1`.
    /// @param encodedOrders0 All orders trading token 0 for token 1, that is,
    /// either orders selling token 0 for token 1 or buying token 1 for token 0.
    /// @param encodedOrders1 All orders trading token 1 for token 2.
    function settle(
        IERC20 token0,
        IERC20 token1,
        int256 d0,
        int256 d1,
        uint256 clearingPrice0,
        uint256 clearingPrice1,
        bytes calldata encodedOrders0,
        bytes calldata encodedOrders1
    ) external {
        revert("not yet implemented");
    }

    /// @dev Returns a unique ID for the specified token pair. Note that the
    /// order in which the tokens are specified does not matter.
    /// @param token0 The address one of the tokens of the pair.
    /// @param token1 The address the other token of the pair.
    /// @return The token ID unique to the pair.
    function pairId(IERC20 token0, IERC20 token1)
        public
        pure
        returns (bytes20)
    {
        require(token0 != token1, "invalid pair");
        return (bytes20(address(token0)) ^ bytes20(address(token1)));
    }
}
