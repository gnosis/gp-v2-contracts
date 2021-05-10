import { BigNumber, BigNumberish, ContractReceipt } from "ethers";
import { ethers } from "hardhat";
import {
  CallMessageTrace,
  DecodedCallMessageTrace,
  isCallTrace,
  isEvmStep,
  isPrecompileTrace,
  PrecompileMessageTrace,
} from "hardhat/internal/hardhat-network/stack-traces/message-trace";

export interface GasTrace {
  name: string;
  cumulativeGas: BigNumber;
  gasUsed?: BigNumber;
  gasRefund?: BigNumber;
  children: GasTrace[];
}

type BN = CallMessageTrace["gasUsed"];

function num(value: BigNumberish | BN): BigNumber {
  return BigNumber.from(value.toString());
}

interface GasTraceish {
  name: string;
  cumulativeGas: BigNumberish | BN;
  gasUsed?: BigNumberish | BN;
  gasRefund?: BigNumberish | BN;
  children?: GasTrace[];
}

function node(trace: GasTraceish): GasTrace {
  const gasRefund = num(trace.gasRefund || 0);
  return {
    name: trace.name,
    cumulativeGas: num(trace.cumulativeGas),
    gasUsed: trace.gasUsed ? num(trace.gasUsed) : undefined,
    gasRefund: gasRefund.isZero() ? undefined : gasRefund,
    children: trace.children || [],
  };
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
  const transactionGas = baseGas + calldataGas;

  const { gasRefund } = trace as unknown as GasExtension;

  return node({
    name: callName(trace),
    cumulativeGas: tx.gasUsed,
    gasRefund,
    children: [
      node({ name: "<base>", cumulativeGas: baseGas }),
      node({
        name: "<calldata>",
        cumulativeGas: transactionGas,
        gasUsed: calldataGas,
      }),
      node({
        name: "<entrypoint>",
        cumulativeGas: trace.gasUsed.addn(transactionGas),
        gasUsed: trace.gasUsed,
        children: computeGasTrace(trace, transactionGas),
      }),
    ],
  });
}

interface FunctionSymbol {
  contractName: string;
  functionName: string;
}

function fallbackSelectors(
  abis: Record<string, string[]>,
): Record<string, FunctionSymbol | undefined> {
  const result: Record<string, FunctionSymbol | undefined> = {};
  for (const [contractName, functionSignatures] of Object.entries(abis)) {
    for (const functionSignature of functionSignatures) {
      const abi = new ethers.utils.Interface([functionSignature]);
      const [func] = Object.values(abi.functions);
      result[abi.getSighash(func)] = {
        contractName,
        functionName: func.name,
      };
    }
  }
  return result;
}

function callName({ address, bytecode, calldata }: CallMessageTrace): string {
  const selector = calldata.slice(0, 4);

  // NOTE: In order to provide better tracing output, here are some manually
  // specified function selectors for contracts that the tracer can't find the
  // source for.
  const FALLBACK_SELECTORS = fallbackSelectors({
    ERC20: [
      "function balanceOf(address)",
      "function transferFrom(address, address, uint256)",
      "function transfer(address, uint256)",
    ],
    UniswapV2Pair: ["function swap(uint256, uint256, address, bytes)"],
  });

  let contractName, functionName;
  if (bytecode) {
    contractName = bytecode.contract.name;
    functionName = bytecode.contract.localFunctions.find((f) =>
      f.selector?.equals(selector),
    )?.name;
  } else {
    const addr = (contractName = ethers.utils.getAddress(
      ethers.utils.hexlify(address),
    ));
    const sighash = ethers.utils.hexlify(selector);

    const fallback = FALLBACK_SELECTORS[sighash];
    if (fallback) {
      ({ contractName, functionName } = fallback);
      contractName = `${contractName}[${addr.substr(0, 6)}..${addr.substr(
        -4,
      )}]`;
    } else {
      contractName = `<${contractName}>`;
      functionName = `<${sighash}>`;
    }
  }

  return `${contractName}.${functionName}`;
}

function precompileName({ precompile }: PrecompileMessageTrace): string {
  switch (precompile) {
    case 1:
      return "@ecrecover";
    // TODO: Add more precompiles if we run into any...
    default:
      return `<precompile 0x${precompile.toString(16)}>`;
  }
}

interface GasExtension {
  gasLeft: BN;
  gasRefund?: BN;
}

function computeGasTrace(
  { steps }: CallMessageTrace,
  transactionGas: BigNumberish,
): GasTrace[] {
  const nodes = [];

  const { gasLeft: initialGasLeft } = steps[0] as unknown as GasExtension;
  const gasLimit = num(initialGasLeft).add(transactionGas);

  for (const [i, step] of steps.entries()) {
    if (isEvmStep(step)) {
      // TODO: Try and keep an internal function stack trace, although this has
      // proven quite difficult as the instruction locations seem all over the
      // place.
      continue;
    }

    const nextStep = steps[i + 1];
    if (!isEvmStep(nextStep)) {
      throw new Error("expected EVM step after sub trace");
    }

    const { gasLeft: gasLeftAfterCall } = nextStep as unknown as GasExtension;
    const cumulativeGas = gasLimit.sub(num(gasLeftAfterCall));
    const { gasUsed } = step;

    if (isCallTrace(step)) {
      const { gasRefund } = step as unknown as GasExtension;
      nodes.push(
        node({
          name: callName(step),
          cumulativeGas,
          gasUsed,
          gasRefund,
          children: computeGasTrace(step, 0),
        }),
      );
    } else if (isPrecompileTrace(step)) {
      nodes.push(
        node({
          name: precompileName(step),
          gasUsed,
          cumulativeGas,
        }),
      );
    }
  }

  return nodes;
}
