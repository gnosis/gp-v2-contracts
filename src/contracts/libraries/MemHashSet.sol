// SPDX-license-identifier: LGPL-3.0-or-newer
pragma solidity ^0.6.12;

/// @title An In-Memory Hash Set
/// @author Gnosis Developers
library MemHashSet {
    /// @dev In-memory hash set data.
    struct Data {
        bytes32[] slots;
    }

    /// @dev Creates a new hash set with the specified maximum capacity.
    /// @param capacity The maximum capacity for this hash set.
    /// @return set An empty in-memory hash set
    function make(uint256 capacity) internal pure returns (Data memory set) {
        set.slots = new bytes32[](capacity);
    }

    /// @dev Inserts a new hash into the set returning `true` if it is a new
    /// value or `false` if it is already present.
    ///
    /// This panics if the hash is invalid (i.e. all zeros) of if there was an
    /// attempt to insert an additional item beyond the hash set's capacity.
    /// @param set The set to insert the hash into.
    /// @param hash The hash to insert into the set.
    /// @return A bool representing if the value was added or already present.
    function insert(Data memory set, bytes32 hash)
        internal
        pure
        returns (bool)
    {
        require(hash != bytes32(0), "invalid hash");

        // NOTE: For the hash set index algorithm, we just compute the position
        // based on the hash and then increment the index on collision.
        for (uint256 i = 0; i < set.slots.length; i++) {
            uint256 index = (uint256(hash) + i) % set.slots.length;
            if (set.slots[index] == bytes32(0)) {
                set.slots[index] = hash;
                return true;
            }
            if (set.slots[index] == hash) {
                return false;
            }
        }

        revert("hash set full");
    }
}
