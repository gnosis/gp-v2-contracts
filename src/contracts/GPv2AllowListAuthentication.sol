// SPDX-License-Identifier: LGPL-3.0
pragma solidity ^0.7.5;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "./interfaces/GPv2Authentication.sol";
import "./ownership/CustomInitiallyOwnable.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is
    CustomInitiallyOwnable,
    GPv2Authentication,
    StorageAccessible
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // solhint-disable-next-line no-empty-blocks
    constructor(address initialOwner) CustomInitiallyOwnable(initialOwner) {}

    EnumerableSet.AddressSet private solvers;

    function addSolver(address solver) external onlyOwner {
        solvers.add(solver);
    }

    function removeSolver(address solver) external onlyOwner {
        solvers.remove(solver);
    }

    function isSolver(address prospectiveSolver)
        external
        view
        override
        returns (bool)
    {
        return solvers.contains(prospectiveSolver);
    }
}
