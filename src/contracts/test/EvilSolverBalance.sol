// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/GPv2SafeERC20.sol";

contract EvilSolverBalance {
    using GPv2SafeERC20 for IERC20;

    address public immutable evilSolver;

    constructor(address evilSolver_) {
        evilSolver = evilSolver_;
    }

    modifier onlyEvilSolver {
        require(tx.origin == evilSolver, "not evil enough");
        _;
    }

    function transferTo(
        IERC20 token,
        address to,
        uint256 value
    ) external onlyEvilSolver {
        token.safeTransfer(to, value);
    }
}
