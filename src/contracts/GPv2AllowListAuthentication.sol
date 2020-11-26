// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.7.5;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "./interfaces/GPv2Authentication.sol";
import "./ownership/CustomInitiallyOwnable.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is
    CustomInitiallyOwnable,
    GPv2Authentication
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // solhint-disable-next-line no-empty-blocks
    constructor(address initialOwner) CustomInitiallyOwnable(initialOwner) {}

    EnumerableSet.AddressSet private solvers;

    function addSolver(address solver) public onlyOwner {
        solvers.add(solver);
    }

    function removeSolver(address solver) public onlyOwner {
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

    function getSolverAt(uint256 index) public view returns (address) {
        return solvers.at(index);
    }

    function numSolvers() public view returns (uint256) {
        return solvers.length();
    }
}
