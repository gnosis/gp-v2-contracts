import { BigNumber, BigNumberish, ContractReceipt } from "ethers";
import Debug from "debug";
import { ethers } from "hardhat";
import {
  CallMessageTrace,
  DecodedCallMessageTrace,
  isCallTrace,
  isEvmStep,
  isPrecompileTrace,
  MessageTraceStep,
} from "hardhat/internal/hardhat-network/stack-traces/message-trace";
import { JumpType } from "hardhat/internal/hardhat-network/stack-traces/model";

const debug = Debug("bench:trace:gas");

export interface GasTrace {
  name: string;
  gas: BigNumber;
  cumulativeGas: BigNumber;
  children: GasTrace[];
}

function node(
  name: string,
  gas: BigNumberish,
  cumulativeGas: BigNumberish,
  children?: GasTrace[],
): GasTrace {
  return { name, gas: BigNumber.from(gas), cumulativeGas: BigNumber.from(cumulativeGas), children: children || [] };
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

  return node(callName(trace), tx.gasUsed, 0, [
    node("<base>", baseGas, 0),
    node("<calldata>", calldataGas, baseGas),
    entrypoint(trace, baseGas + calldataGas),
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

function entrypoint(trace: CallMessageTrace, startingGas: BigNumberish): GasTrace {
  const tracer = new CodeTracer(trace, startingGas);
  const name = "<entrypoint>";
  return node(name, trace.gasUsed.toString(), 0, tracer.traceToEnd(name));
}

type GasExtended<T> = T & {
  gasLeft?: unknown;
  gasRefund?: unknown;
}

class CodeTracer {
  private stepIndex = -1;

  constructor(
    public readonly trace: CallMessageTrace,
    private readonly startingGas: BigNumberish,
  ) {}

  get step(): GasExtended<MessageTraceStep> {
    return this.trace.steps[this.stepIndex];
  }

  private get cumulativeGas(): BigNumber {
    return BigNumber.from(this.startingGas);
  }

  private nextStep(): GasExtended<MessageTraceStep> {
    this.stepIndex++;
    return this.step;
  }

  public traceToEnd(name: string): GasTrace[] {
    const nodes = this.traceLocal(name);
    if (this.step) {
      throw new Error("trace to end with remaining steps")
    }

    return nodes;
  }

  private traceLocal(name: string): GasTrace[] {
    debug(`>>> entering ${name}`);
    
    const nodes = [];
    let step;
    while (step = this.nextStep()) {
      const { gasLeft, gasRefund } = step;
      if (isEvmStep(step)) {
        // TODO: Stack trace is not very accurate with optimizations turned on.
        const instruction = this.trace.bytecode?.getInstruction(step.pc)
        const jumpType = instruction?.jumpType;
        if (jumpType == JumpType.INTO_FUNCTION) {
            const name = instruction?.location?.getContainingFunction()?.name || "<unknown>";
            const startingGas = BigNumber.from(`${gasLeft || 0}`);
            const children = this.traceLocal(name);
            const endingGas = BigNumber.from(`${this.step?.gasLeft || 0}`);
            nodes.push(node(
              name,
              startingGas.sub(endingGas),
              this.cumulativeGas,
              children,
            ))
        } else if (jumpType == JumpType.OUTOF_FUNCTION) {
          break;
        }
      } else if (isCallTrace(step)) {
        const subTracer = new CodeTracer(step, this.startingGas);
        const name = callName(step);
        nodes.push(
          node(name, step.gasUsed.toString(), this.cumulativeGas, subTracer.traceToEnd(name)),
        );
      } else if (isPrecompileTrace(step)) {
        nodes.push(
          node(`<precompile 0x${step.precompile}>`, step.gasUsed.toString(), this.cumulativeGas),
        );
      }
    }

    debug(`<<< exiting ${name}`);
    return nodes;
  }
}
