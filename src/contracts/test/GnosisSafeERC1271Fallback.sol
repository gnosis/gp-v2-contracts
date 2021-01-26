// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity >=0.5.0 <0.7.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/interfaces/ISignatureValidator.sol";

/// EIP-1271 has seen changes in the years. The Gnosis Safe implementation has
/// now diverged from the standard. This contract can be used to bridge the old
/// implementation to the new one *in a testing environment*. It relies on the
/// old ERC-1271 implementation to validate signatures. It is intended to be
/// used as a fallback contract for a safe. It should not be used in a real
/// contract since signing a message for the old ERC-1271 implementation could
/// mean also having signed a different message with the new implementation.
contract GnosisSafeEIP1271Fallback is ISignatureValidatorConstants {
    bytes4 internal constant UPDATED_MAGIC_VALUE = 0x1626ba7e;

    function isValidSignature(bytes32 _data, bytes calldata _signature)
        external
        returns (bytes4)
    {
        // The fallback manager invokes this contract with a standard call from
        // the Gnosis Safe context.
        GnosisSafe safe = GnosisSafe(msg.sender);
        bytes4 value = safe.isValidSignature(abi.encode(_data), _signature);
        return (value == EIP1271_MAGIC_VALUE) ? UPDATED_MAGIC_VALUE : bytes4(0);
    }
}
