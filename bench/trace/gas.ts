import { BigNumber, BigNumberish, ContractReceipt } from "ethers";
import { ethers } from "hardhat";
import {
  CallMessageTrace,
  DecodedCallMessageTrace,
  isCallTrace,
  isEvmStep,
  isPrecompileTrace,
} from "hardhat/internal/hardhat-network/stack-traces/message-trace";

export interface GasTrace {
  name: string;
  gas: BigNumber;
  children: GasTrace[];
}

function node(
  name: string,
  gas: BigNumberish,
  children?: GasTrace[],
): GasTrace {
  return { name, gas: BigNumber.from(gas), children: children || [] };
}

export function decodeGasTrace(
  tx: ContractReceipt,
  trace: DecodedCallMessageTrace,
): GasTrace {
  // NOTE: The `gasUsed` data from the trace is just for the code execution, and
  // does not account for other gas costs when executing a transaction.
  // Specifically, create a gas trace node for the fixed base transaction cost
  // as well as the calldata gas cost which costs 4 gas per `0` byte and 16 gas
  // per non-`0` byte.
  const baseGas = 21000;
  const calldataGas = trace.calldata.reduce(
    (gas, byte) => gas + (byte === 0 ? 4 : 16),
    0,
  );

  return node(callName(trace), tx.gasUsed, [
    node("<base>", baseGas),
    node("<calldata>", calldataGas),
    entrypoint(trace),
  ]);
}

function callName({ address, bytecode, calldata }: CallMessageTrace): string {
  const selector = calldata.slice(0, 4);

  let contractName, functionName;
  if (bytecode) {
    contractName = bytecode.contract.name;
    functionName = bytecode.contract.localFunctions.find((f) =>
      f.selector?.equals(selector),
    )?.name;
  } else {
    contractName = `<${ethers.utils.getAddress(
      ethers.utils.hexlify(address),
    )}>`;
  }

  return `${contractName}.${
    functionName || `<${ethers.utils.hexlify(selector)}>`
  }`;
}

function entrypoint({ steps, gasUsed }: CallMessageTrace): GasTrace {
  const children = [];
  for (const step of steps) {
    if (isEvmStep(step)) {
      // TODO: Try and keep an internal function stack trace, although this
      // has proven quite challenging with optimizations turned on.
    } else if (isCallTrace(step)) {
      children.push(externFunction(step));
    } else if (isPrecompileTrace(step)) {
      children.push(
        node(`<precompile 0x${step.precompile}>`, step.gasUsed.toString()),
      );
    }
  }

  return node("<entrypoint>", gasUsed.toString(), children);
}

function externFunction(
  trace: CallMessageTrace | DecodedCallMessageTrace,
): GasTrace {
  const { children } = entrypoint(trace);
  return node(callName(trace), trace.gasUsed.toString(), children);
}
