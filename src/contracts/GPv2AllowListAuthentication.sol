// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "./interfaces/GPv2Authentication.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is GPv2Authentication, StorageAccessible {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public manager;

    EnumerableSet.AddressSet private solvers;

    function initializeManager(address manager_) external {
        require(manager == address(0), "GPv2: already initialized");
        manager = manager_;
    }

    modifier onlyManager() {
        require(manager == msg.sender, "GPv2: caller not manager");
        _;
    }

    function addSolver(address solver) external onlyManager {
        solvers.add(solver);
    }

    function removeSolver(address solver) external onlyManager {
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
