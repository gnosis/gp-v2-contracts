import assert from "assert";

import {
  BigNumber,
  BytesLike,
  Contract,
  ContractFactory,
  Signer,
  ethers,
} from "ethers";

const OPCODES: Record<string, number | undefined> = {
  STOP: 0x00,
  ISZERO: 0x15,
  ADDRESS: 0x30,
  CALLVALUE: 0x34,
  RETURNDATASIZE: 0x3d,
  COINBASE: 0x41,
  MSTORE: 0x52,
  JUMPI: 0x57,
  GAS: 0x5a,
  CALL: 0xf1,
  RETURN: 0xf3,
};
const PUSH1_OPCODE = 0x60;

function assemble(source: string): BytesLike {
  const bytecode = source
    .split("\n")
    .map((line) => line.replace(/;;.*$/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [op, param] = line.split(" ").map((part) => part.trim());
      // op-codes from <https://ethervm.io/>
      if (param === undefined) {
        const opcode = OPCODES[op];
        if (opcode === undefined) {
          throw new Error(`unsupported op ${op}`);
        }
        return [opcode];
      } else {
        if (op.toUpperCase() !== "PUSH") {
          throw new Error(`unsupported parameterized op ${op}`);
        }

        // compute the byte-encoded value for this parameter. Note that we use
        // the ABI coder to ensure it fits into a `uint256` (`BigNumber` has
        // arbitrary size) and use `toHexString` to strip leading 0's with
        // special handling for the 0 value.
        const value = Array.from(
          ethers.utils.arrayify(
            BigNumber.from(
              ethers.utils.defaultAbiCoder.encode(["uint256"], [param]),
            ).toHexString(),
          ),
        );
        assert(value.length > 0 && value.length <= 32);

        const opcode = PUSH1_OPCODE + value.length - 1;
        return [opcode, ...value];
      }
    })
    .reduce((bytecode, opcodes) => [...bytecode, ...opcodes], []);

  return ethers.utils.hexlify(bytecode);
}

export const MINER_PAYOUT_CODE = assemble(`
  ;; This contract just forwards the received value to the coinbase address.

  ;; Start by pushing the required 'CALL' parameters to the stack in the correct
  ;; order:
  ;; First, push the return data length and and offset. Since we don't care
  ;; about the return data at all, we can just specify 0's for these two
  ;; parameters. We use 'RETURNDATASIZE' to push 0's onto the stack since its
  ;; guaranteed to be 0 before doing any calls. This saves us 1 gas and 1
  ;; byte of code over 'PUSH1 0x00'
  RETURNDATASIZE ;; PUSH 0
  RETURNDATASIZE ;; PUSH 0

  ;; Second, push the calldata length and offset, again 0's because we don't
  ;; want to provide any calldata. We use 'RETURNDATASIZE' for 0's for the same
  ;; reason as above.
  RETURNDATASIZE ;; PUSH 0
  RETURNDATASIZE ;; PUSH 0

  ;; Third, push the 'CALL' value for the transaction to the coinbase address.
  ;; This should be whatever value was used to call this contract.
  CALLVALUE

  ;; Forth, push the address to 'CALL', that is the recipient of this transfer
  ;; transaction. This is the coinbase address.
  COINBASE

  ;; Fifth, push the gas to use for the transaction. For simplicity and gas
  ;; efficiency, just forward all remaining gas.
  GAS

  ;; Finally, execute the transaction for transferring the Ether.
  CALL

  ;; Now, our stack should only have a single value on it, which is the result
  ;; of the previous call - 1 for success and 0 for failure. We can check for
  ;; failure by jumping to an invalid code location if the success is zero.
  ;; Jumping to an invalid code location causes an 'INVALID' trap to be raised,
  ;; causing the call to this contract to fail.
  ISZERO
  ADDRESS ;; Random invalid location - costs 2 gas and 1 byte of code
  JUMPI

  ;; If we got here, that means that the call was successful because we did not
  ;; jump to an invalid address. So just halt execution, returning no data.
  STOP
`);

export const MINER_PAYOUT_CREATION_CODE = assemble(`
  ;; This is the creation code for the code to forward transferred value to the
  ;; block coinbase address.

  ;; Creation code works by writing and returning code from memory, so lets
  ;; start by writing the bytecode assembled above into memory at address 0 and
  ;; then returning. Once again we use 'RETURNDATASIZE' to push 0's onto the
  ;; stack.

  ;; First push the data that we want to write to memory, i.e. the code. Note
  ;; that we right-pad the bytes so that the first byte of code that is written
  ;; to memory is at offset 0.
  PUSH ${ethers.utils.hexlify(MINER_PAYOUT_CODE).padEnd(66, "0")}

  ;; Then we want to write this to offset 0.
  RETURNDATASIZE ;; PUSH 0
  MSTORE

  ;; Now return our code. We wrote it to memory offset 0, and we just need to
  ;; push its length onto the stack so that we can return the contract code.
  PUSH ${ethers.utils.hexDataLength(MINER_PAYOUT_CODE)}
  RETURNDATASIZE ;; PUSH 0
  RETURN
`);

export const MinerPayoutFactory = new ContractFactory(
  [{ stateMutability: "payable", type: "receive" }],
  MINER_PAYOUT_CREATION_CODE,
);

/**
 * The signing scheme used to sign the order.
 */
export async function deployMinerPayoutContract(
  signer: Signer,
): Promise<Contract> {
  return await MinerPayoutFactory.connect(signer).deploy();
}
