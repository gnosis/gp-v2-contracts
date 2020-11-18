// SPDX-License-Identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

interface GPv2Authentication {
    function isSolver(address prospectiveSolver) external view returns (bool);
}
