// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./interfaces/GPv2Authentication.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is
    GPv2Authentication,
    StorageAccessible,
    Initializable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    address public manager;

    EnumerableSet.AddressSet private solvers;

    function setManager(address _manager) external initializer {
        manager = _manager;
    }

    modifier onlyManager() {
        require(manager == msg.sender, "caller is not the manager");
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
