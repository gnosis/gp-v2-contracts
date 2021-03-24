import { BigNumber, BytesLike, Contract } from "ethers";

type AllowListReaderMethods = "areSolvers";
type AllowListReaderParameters<M> = M extends "areSolvers"
  ? [BytesLike[]]
  : never;

type SettlementReaderMethods = "filledAmountsForOrders";
type SettlementReaderParameters<M> = M extends "filledAmountsForOrders"
  ? [BytesLike[]]
  : never;

type ReaderMethods = AllowListReaderMethods | SettlementReaderMethods;
type ReaderParameters<M> =
  | AllowListReaderParameters<M>
  | SettlementReaderParameters<M>;

/**
 * A generic method used to obfuscate the complexity of reading storage
 * of any StorageAccessible contract. That is, this method does the work of
 * 1. Encoding the function call on the reader
 * 2. Simulates delegatecall of storage read with encoded calldata
 * 3. Decodes the returned bytes from the storage read into expected return value.
 */
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
   * Returns true if all the specified addresses are allowed solvers.
   */
  public areSolvers(solvers: BytesLike[]): Promise<string> {
    return readStorage(this.allowList, this.reader, "areSolvers", [solvers]);
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
