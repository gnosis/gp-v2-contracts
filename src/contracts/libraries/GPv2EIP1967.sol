// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.7.6;

library GPv2EIP1967 {
    /// @dev The storage slot where the proxy implementation is stored, defined
    /// as `keccak256('eip1967.proxy.implementation') - 1`.
    bytes32 internal constant IMPLEMENTATION_SLOT =
        hex"360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

    /// @dev The storage slot where the proxy administrator is stored, defined
    /// as `keccak256('eip1967.proxy.admin') - 1`.
    bytes32 internal constant ADMIN_SLOT =
        hex"b53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

    /// @dev Returns the address stored in the EIP-1967 implementation storage
    /// slot for the current contract. If this method is not called from an
    /// EIP-1967 contract, then it will likely return `address(0)`.
    /// as `keccak256('eip1967.proxy.implementation') - 1`.
    ///
    /// @return implementation The implementation address.
    function getImplementation()
        internal
        view
        returns (address implementation)
    {
        // NOTE: Assembly is required for reading and writing storage at
        // arbirary slots.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            implementation := sload(IMPLEMENTATION_SLOT)
        }
    }

    /// @dev Sets the storage at the EIP-1967 implementation slot to be the
    /// specified address.
    ///
    /// @param implementation The implementation address to set.
    function setImplementation(address implementation) internal {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
    }

    /// @dev Returns the address stored in the EIP-1967 administrator storage
    /// slot for the current contract.
    ///
    /// @return admin The administrator address.
    function getAdmin() internal view returns (address admin) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            admin := sload(ADMIN_SLOT)
        }
    }

    /// @dev Sets the storage at the EIP-1967 administrator slot to be the
    /// specified address.
    ///
    /// @param admin The administrator address to set.
    function setAdmin(address admin) internal {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(ADMIN_SLOT, admin)
        }
    }
}
