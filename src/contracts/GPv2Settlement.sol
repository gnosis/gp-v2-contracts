// SPDX-license-identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

/// @title Gnosis Protocol v2 Settlement Contract
/// @author Gnosis Developers
contract GPv2Settlement {
    /// @dev The domain separator used for signing orders that gets mixed in
    /// making signatures for different domains incompatible.
    string private constant DOMAIN_SEPARATOR = "GPv2";

    /// @dev The stride of an encoded order.
    uint256 private constant ORDER_STRIDE = 126;

    /// @dev Replay protection that is mixed with the order data for signing.
    /// This is done in order to avoid chain and domain replay protection, so
    /// that signed orders are only valid for specific GPv2 contracts.
    ///
    /// The replay protection is defined as the Keccak-256 hash of `"GPv2"`
    /// followed by the chain ID and finally the contract address.
    bytes32 public immutable replayProtection;

    /// @dev The Uniswap factory. This is used as the AMM that GPv2 settles with
    /// and is responsible for determining the range of the settlement price as
    /// well as trading surplus that cannot be directly settled in a batch.
    IUniswapV2Factory public immutable uniswapFactory;

    /// @dev A mapping from a Uniswap token pair address to the nonce of the
    /// last settled batch (a value of 0 indicates that no batches have been
    /// settled for the specified pair). This is used to ensure orders can't be
    /// replayed in multiple batches.
    ///
    /// The next batch to be settled for the specified pair will use the nonce
    /// `nonces[pair] + 1`. This is so the no batches with nonce `0` can exist
    /// as that value is reserved for orders to indicate that they can be
    /// replayed in any batch.
    mapping(IUniswapV2Pair => uint256) public nonces;

    /// @param uniswapFactory_ The Uniswap factory to act as the AMM for this
    /// GPv2 settlement contract.
    constructor(IUniswapV2Factory uniswapFactory_) public {
        uint256 chainId;

        // NOTE: Currently, the only way to get the chain ID in solidity is
        // using assembly.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        replayProtection = keccak256(
            abi.encode(DOMAIN_SEPARATOR, chainId, address(this))
        );
        uniswapFactory = uniswapFactory_;
    }

    // TODO(nlordell): Remove this once the `settle` function is implemented.
    // solhint-disable no-unused-vars

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
    ///     validTo:        uint32,
    ///     tip:            uint112,
    ///     flags:          uint8,
    ///     executedAmount: uint112,
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
    /// was specified from, either `encodedOrder0` (which sells token 0 and buys
    /// token 1) or `encodedOrder1` (which sells token 1 and buys token 0).
    /// Additionally, the nonce is not encoded as part of the order bytes as the
    /// nonce is included in the signature. For an order to be valid it must
    /// either be the current nonce, or be a replayable order (nonce of 0). If
    /// the nonce were incorrect (i.e. attempted to use an order in a different
    /// batch than it was signed for), then the signature recovery would fail.
    /// This allows us to encode the nonce value in a single bit as part of the
    /// flags, were a `0` represents the nonce should be for the current batch
    /// and a `1` represents that it is a replayble order and the nonce should
    /// be 0.
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
        IUniswapV2Pair pair = uniswapPairAddress(token0, token1);
        uint256 nonce = fetchIncrementNonce(pair);

        revert("not yet implemented");
    }

    // solhint-enable

    /// @dev Returns a unique pair address for the specified tokens. Note that
    /// the tokens must be in lexicographical order or else this call reverts.
    /// This is required to ensure that the `token0` and `token1` are in the
    /// same order as the Uniswap pair.
    /// @param token0 The address one token in the pair.
    /// @param token1 The address the other token in the pair.
    /// @return The address of the Uniswap token pair.
    function uniswapPairAddress(IERC20 token0, IERC20 token1)
        public
        view
        returns (IUniswapV2Pair)
    {
        require(
            address(token0) != address(0) && address(token0) < address(token1),
            "invalid pair"
        );

        // NOTE: The address of a Uniswap pair is deterministic as it is created
        // with `CREATE2` instruction. This allows us get the pair address
        // without requesting any chain data!
        // See <https://uniswap.org/docs/v2/smart-contract-integration/getting-pair-addresses/>.
        bytes32 pairAddressBytes = keccak256(
            abi.encodePacked(
                hex"ff",
                address(uniswapFactory),
                keccak256(abi.encodePacked(address(token0), address(token1))),
                hex"96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f"
            )
        );
        return IUniswapV2Pair(uint256(pairAddressBytes));
    }

    /// @dev Increments the nonce for the specified pair and returns the new
    /// value (i.e. after incrementing).
    ///
    /// Note that the nonce value after incrementing is used for a batch as this
    /// ensures that the nonce `0` is never used for a batch. This is important
    /// as `0` is a special nonce value used for orders that have disabled
    /// replay protection.
    /// @param pair The token pair to increment and retrieve the nonce for.
    /// @return nonce The nonce before incrementing.
    function fetchIncrementNonce(IUniswapV2Pair pair)
        internal
        returns (uint256 nonce)
    {
        // NOTE: The nonce is offset by 1 as `0` is a special value to signal
        // that an order can be replayed in all batches.
        nonce = nonces[pair] + 1;

        // SAFETY: This is the only place the nonce is modified. The `nonce`
        // cannot realistically overflow by adding one at a time, as that would
        // take 2^256 transactions to achieve!
        nonces[pair] = nonce;
    }

    /// @dev Decodes an order from calldata bytes returning order parameters.
    /// @param encodedOrder The order as encoded calldata bytes.
    function decodeOrder(bytes calldata encodedOrder)
        internal
        pure
        returns (
            uint112 sellAmount,
            uint112 buyAmount,
            uint32 validTo,
            uint112 tip,
            uint8 flags,
            uint112 executedAmount,
            uint8 v,
            bytes32 r,
            bytes32 s
        )
    {
        // NOTE: This is currently unnecessarily gas inefficient. Specifically,
        // there is a potentially extraneous check to the encoded order length
        // (this can be verified once for the total encoded orders length).
        // Additionally, Solidity generates bounds checks for each `abi.decode`
        // and slice operation. Unfortunately using `assmebly { calldataload }`
        // is quite ugly here since there is no mechanism to get calldata
        // offsets (like there is for memory offsets) without manual
        // computation, which is brittle as changes to the `settle` function
        // signature would require manual adjustments to the computation. Once
        // gas benchmarking is set up, we can evaluate if it is worth the extra
        // effort.

        require(encodedOrder.length == ORDER_STRIDE, "malformed order data");

        sellAmount = uint112(
            abi.decode(encodedOrder[0:], (uint256)) >> (256 - 112)
        );
        buyAmount = uint112(
            abi.decode(encodedOrder[14:], (uint256)) >> (256 - 112)
        );
        validTo = uint32(
            abi.decode(encodedOrder[28:], (uint256)) >> (256 - 32)
        );
        tip = uint112(abi.decode(encodedOrder[32:], (uint256)) >> (256 - 112));
        flags = uint8(encodedOrder[46]);
        executedAmount = uint112(
            abi.decode(encodedOrder[47:], (uint256)) >> (256 - 112)
        );
        v = uint8(encodedOrder[61]);
        r = bytes32(abi.decode(encodedOrder[62:], (uint256)));
        s = bytes32(abi.decode(encodedOrder[94:], (uint256)));
    }
}
