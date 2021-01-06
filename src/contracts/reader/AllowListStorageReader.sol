// SPDX-License-Identifier: LGPL-3.0
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../GPv2AllowListAuthentication.sol";

/// @title Gnosis Protocol v2 Allow List Storage Reader
/// @author Gnosis Developers
contract AllowListStorageReader {
    using EnumerableSet for EnumerableSet.AddressSet;

    address private _owner;
    EnumerableSet.AddressSet private solvers;

    function getSolverAt(uint256 index) external view returns (address) {
        return solvers.at(index);
    }

    function numSolvers() external view returns (uint256) {
        return solvers.length();
    }
}
