import { BigNumberish, Contract } from "ethers";

type ReaderMethods = "getSolverAt" | "numSolvers" | "filledAmountsForOrders";
type ReaderParameters<M> = M extends "getSolverAt"
  ? [BigNumberish]
  : M extends "filledAmountsForOrders"
  ? [string[]]
  : M extends "numSolvers"
  ? []
  : never;

async function readStorage<M extends ReaderMethods>(
  base: Contract,
  reader: Contract,
  method: M,
  parameters: ReaderParameters<M>,
) {
  const encodedCall = reader.interface.encodeFunctionData(
    method,
    parameters || [],
  );
  const resultBytes = await base.callStatic.simulateDelegatecall(
    reader.address,
    encodedCall,
  );
  return reader.interface.decodeFunctionResult(method, resultBytes)[0];
}

/**
 * A class for attaching the storage reader contract to a solver allow list for
 * providing additional storage reading methods.
 */
export class AllowListReader {
  constructor(
    public readonly allowList: Contract,
    public readonly reader: Contract,
  ) {}

  /**
   * Read the address of the solver at the specified index.
   */
  public getSolverAt(index: number): Promise<string> {
    return readStorage(this.allowList, this.reader, "getSolverAt", [index]);
  }

  /**
   * Read the total number of authorized solvers in the allow list contract.
   */
  public numSolvers(): Promise<number> {
    return readStorage(this.allowList, this.reader, "numSolvers", []);
  }
}

/**
 * A class for attaching the storage reader contract to the GPv2Settlement contract
 * for providing additional storage reading methods.
 */
export class SettlementReader {
  constructor(
    public readonly settlement: Contract,
    public readonly reader: Contract,
  ) {}

  /**
   * Read and return filled amounts for a list of orders
   */
  public filledAmountsForOrders(orderUids: string[]): Promise<number> {
    return readStorage(this.settlement, this.reader, "filledAmountsForOrders", [
      orderUids,
    ]);
  }
}
