// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import "./IERC20.sol";

interface IVault {
    struct BalanceTransfer {
        IERC20 token;
        uint256 amount;
        address sender;
        address recipient;
    }

    struct SwapIn {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountIn;
        bytes userData;
    }

    struct SwapOut {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountOut;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address recipient;
        bool toInternalBalance;
    }

    enum SwapKind {GIVEN_IN, GIVEN_OUT}

    struct SwapRequest {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amount;
        bytes userData;
    }

    function depositToInternalBalance(BalanceTransfer[] calldata transfers)
        external;

    function withdrawFromInternalBalance(BalanceTransfer[] calldata transfers)
        external;

    function transferInternalBalance(BalanceTransfer[] calldata transfers)
        external;

    function batchSwapGivenIn(
        SwapIn[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds,
        int256[] memory limits,
        uint256 deadline
    ) external returns (int256[] memory);

    function batchSwapGivenOut(
        SwapOut[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds,
        int256[] memory limits,
        uint256 deadline
    ) external returns (int256[] memory);
}
