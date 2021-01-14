// SPDX-License-Identifier: MIT

/**
 * This file is adapted the OpenZeppelin implementation which is not yet
 * released on npm to also allow minting.
 *
 * Once a new OpenZeppelin version is released, this contract should be removed.
 *
 * Origianl source:
 * <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/drafts/IERC20Permit.sol>
 */

pragma solidity >=0.6.5 <0.8.0;

import "@openzeppelin/contracts/presets/ERC20PresetMinterPauser.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @dev Implementation of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on `{IERC20-approve}`, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 */
contract ERC20Permit is ERC20PresetMinterPauser {
    using Counters for Counters.Counter;

    mapping(address => Counters.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public immutable DOMAIN_SEPARATOR;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private immutable _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    /**
     * @dev Initializes the {EIP712} domain separator using the `name` parameter, and setting `version` to `"1"`.
     *
     * It's a good idea to use the same `name` that is defined as the ERC20 token name.
     */
    constructor(string memory symbol) ERC20PresetMinterPauser(symbol, symbol) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,address verifyingContract)"
                ),
                keccak256(bytes(symbol)),
                address(this)
            )
        );
    }

    /**
     * @dev See {IERC20Permit-permit}.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash =
            keccak256(
                abi.encode(
                    _PERMIT_TYPEHASH,
                    owner,
                    spender,
                    value,
                    _nonces[owner].current(),
                    deadline
                )
            );

        bytes32 hash =
            keccak256(
                abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
            );

        bytes memory signature = abi.encodePacked(r, s, v);

        address signer = ECDSA.recover(hash, signature);
        require(signer == owner, "ERC20Permit: invalid signature");

        _nonces[owner].increment();
        _approve(owner, spender, value);
    }

    /**
     * @dev See {IERC20Permit-nonces}.
     */
    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner].current();
    }
}
