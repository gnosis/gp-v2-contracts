import { BigNumberish, Contract } from "ethers";

type ReaderMethods = "getSolverAt" | "numSolvers";
type ReaderParameters<M> = M extends "getSolverAt"
  ? [BigNumberish]
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

export class AllowListReader {
  constructor(
    public readonly allowList: Contract,
    public readonly reader: Contract,
  ) {}
  public getSolverAt(index: number): Promise<string> {
    return readStorage(this.allowList, this.reader, "getSolverAt", [index]);
  }
  public numSolvers(): Promise<number> {
    return readStorage(this.allowList, this.reader, "numSolvers", []);
  }
}
