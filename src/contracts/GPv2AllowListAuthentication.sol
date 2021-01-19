// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "./interfaces/GPv2Authentication.sol";

/// @title Gnosis Protocol v2 Access Control Contract
/// @author Gnosis Developers
contract GPv2AllowListAuthentication is GPv2Authentication, StorageAccessible {
    using EnumerableSet for EnumerableSet.AddressSet;
    address private _owner;
    bool private initialized;

    EnumerableSet.AddressSet private solvers;

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    EnumerableSet.AddressSet private solvers;

    // solhint-disable-next-line no-empty-blocks
    // constructor(address initialOwner) CustomInitiallyOwnable(initialOwner) {}
    function initialize(address initialOwner) public {
        require(!initialized, "Contract already initialized");
        initialized = true;
        transferOwnership(initialOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: owner is zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view returns (address) {
        return _owner;
    }

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
