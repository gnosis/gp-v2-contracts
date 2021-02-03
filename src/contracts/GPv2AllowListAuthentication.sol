// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

import "@gnosis.pm/util-contracts/contracts/StorageAccessible.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Proxy.sol";
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

    modifier onlyProxyAdmin() {
        // Slot taken from https://eips.ethereum.org/EIPS/eip-1967#specification
        // obtained as bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
        bytes32 slot =
            0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
        address proxyAdmin;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            proxyAdmin := sload(slot)
        }
        require(msg.sender == proxyAdmin, "GPv2: caller not proxyAdmin");
        _;
    }

    modifier onlyManager() {
        require(manager == msg.sender, "GPv2: caller not manager");
        _;
    }

    function updateManager(address newManager) external onlyProxyAdmin {
        manager = newManager;
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
