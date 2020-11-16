// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AccessControl is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private solvers;

    function addSolver(address solverAddress) public {
        solvers.add(solverAddress);
    }

    function isSolver(address prospectiveSolver) public view returns (bool) {
        return solvers.contains(prospectiveSolver);
    }

    function getSolverAt(uint256 index) public view returns (address) {
        return solvers.at(index);
    }

    function numSolvers() public view returns (uint256) {
        return solvers.length();
    }
}
