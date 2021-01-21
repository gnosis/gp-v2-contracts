import { ethers } from "hardhat";

interface DeployFunction {
  encode(bytecode: string, args?: []): string;
}

class CompatInterface extends ethers.utils.Interface {
  public readonly deployFunction: DeployFunction;
  constructor(fragments: unknown) {
    super(fragments as string);
    this.deployFunction = {
      encode: (b: string, a?: unknown[]) =>
        ethers.utils.hexConcat([b, this.encodeDeploy(a || [])]),
    };
  }
}

export interface CompatProvider {
  sendAsync(
    payload: {
      params: unknown[];
      method: string;
      id: number;
      jsonrpc: string;
    },
    callback: (
      err: Error | null,
      result?: {
        result: unknown;
        id: number;
        jsonrpc: string;
        error?: {
          message: string;
          code: number;
        };
      },
    ) => void,
  ): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __ethers = (ethers as unknown) as any;
const __Interface = ethers.utils.Interface;

export async function withCompatProvider<T>(
  callback: (provider: CompatProvider) => Promise<T>,
): Promise<T> {
  const compatProvider: CompatProvider = {
    sendAsync: function ({ method, params }, callback) {
      ethers.provider
        .send(method, params)
        .then((result) => {
          callback(null, {
            result,
            id: 0,
            jsonrpc: "v2",
          });
        })
        .catch((err) => {
          callback(err);
        });
    },
  };

  let result;
  __ethers.utils.Interface = CompatInterface;
  try {
    result = await callback(compatProvider);
  } finally {
    __ethers.utils.Interface = __Interface;
  }

  return result;
}
