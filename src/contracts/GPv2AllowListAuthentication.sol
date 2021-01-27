// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/GPv2Authentication.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is
    GPv2Authentication,
    StorageAccessible,
    OwnableUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

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
