import { BigNumber, BigNumberish, BytesLike, Contract } from "ethers";

type AllowListReaderMethods = "getSolverAt" | "numSolvers";
type AllowListReaderParameters<M> = M extends "getSolverAt"
  ? [BigNumberish]
  : M extends "numSolvers"
  ? []
  : never;

type SettlementReaderMethods = "filledAmountsForOrders";
type SettlementReaderParameters<M> = M extends "filledAmountsForOrders"
  ? [BytesLike[]]
  : never;

type ReaderMethods = AllowListReaderMethods | SettlementReaderMethods;
type ReaderParameters<M> =
  | AllowListReaderParameters<M>
  | SettlementReaderParameters<M>;

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
  public filledAmountsForOrders(orderUids: BytesLike[]): Promise<BigNumber[]> {
    return readStorage(this.settlement, this.reader, "filledAmountsForOrders", [
      orderUids,
    ]);
  }
}
