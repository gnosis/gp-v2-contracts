// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/proxy/Initializable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "./interfaces/GPv2Authentication.sol";
import "./libraries/GPv2EIP1967.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is
    GPv2Authentication,
    Initializable,
    StorageAccessible
{
    using EnumerableSet for EnumerableSet.AddressSet;

    address public manager;

    EnumerableSet.AddressSet private solvers;

    function initializeManager(address manager_) external initializer {
        manager = manager_;
    }

    modifier onlyManager() {
        require(manager == msg.sender, "GPv2: caller not manager");
        _;
    }

    modifier onlyManagerOrOwner() {
        require(
            manager == msg.sender || GPv2EIP1967.getAdmin() == msg.sender,
            "GPv2: not authorized"
        );
        _;
    }

    function setManager(address manager_) external onlyManagerOrOwner {
        manager = manager_;
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
