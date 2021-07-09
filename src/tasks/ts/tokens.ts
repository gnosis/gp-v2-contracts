import WethNetworks from "canonical-weth/networks.json";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractTransaction,
  providers,
  Signer,
} from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { SupportedNetwork, isSupportedNetwork } from "./deployment";

export interface TokenDetails {
  contract: Contract;
  symbol: string | null;
  decimals: number | null;
  address: string;
}

export interface NativeToken {
  symbol: string;
  decimals: number;
  provider: providers.JsonRpcProvider;
}

export const NATIVE_TOKEN_SYMBOL: Record<
  SupportedNetwork | "hardhat",
  string
> = {
  hardhat: "ETH",
  mainnet: "ETH",
  rinkeby: "ETH",
  xdai: "xDAI",
};

export const WRAPPED_NATIVE_TOKEN_ADDRESS: Record<SupportedNetwork, string> = {
  mainnet: WethNetworks.WETH9[1].address,
  rinkeby: WethNetworks.WETH9[4].address,
  xdai: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
};

export function isNativeToken(
  token: TokenDetails | NativeToken,
): token is NativeToken {
  return (token as TokenDetails).contract === undefined;
}

export function displayName(token: TokenDetails | NativeToken): string {
  if (isNativeToken(token)) {
    return token.symbol;
  } else {
    return token.symbol ? `${token.symbol} (${token.address})` : token.address;
  }
}

export async function balanceOf(
  token: TokenDetails | NativeToken,
  user: string,
): Promise<BigNumber> {
  const balanceFunction = isNativeToken(token)
    ? token.provider.getBalance
    : token.contract.balanceOf;
  return BigNumber.from(await balanceFunction(user));
}

export async function transfer(
  token: TokenDetails | NativeToken,
  from: Signer,
  to: string,
  amount: BigNumberish,
): Promise<ContractTransaction | providers.TransactionResponse> {
  const transferFunction: (
    to: string,
    amount: BigNumberish,
  ) => ContractTransaction | providers.TransactionResponse = isNativeToken(
    token,
  )
    ? (to, value) => from.sendTransaction({ to, value })
    : token.contract.connect(from).transfer;
  return await transferFunction(to, amount);
}

export function nativeToken({
  ethers,
  network,
}: HardhatRuntimeEnvironment): NativeToken {
  if (network.name !== "hardhat" && !isSupportedNetwork(network.name)) {
    throw new Error(
      `Cannot retrieve native token for unsupported network ${network.name}`,
    );
  }
  return {
    symbol: NATIVE_TOKEN_SYMBOL[network.name],
    decimals: 18, // assumption: every network supported by our protocol uses an 18-decimal native token
    provider: ethers.provider,
  };
}

export async function tokenDetails(
  address: string,
  hre: HardhatRuntimeEnvironment,
): Promise<TokenDetails> {
  const IERC20 = await hre.artifacts.readArtifact(
    "src/contracts/interfaces/IERC20.sol:IERC20",
  );
  const contract = new Contract(address, IERC20.abi, hre.ethers.provider);
  const [symbol, decimals] = await Promise.all([
    contract
      .symbol()
      .then((s: unknown) => (typeof s !== "string" ? null : s))
      .catch(() => null),
    contract
      .decimals()
      .then((s: unknown) => BigNumber.from(s))
      .catch(() => null),
  ]);
  return {
    contract,
    symbol,
    decimals,
    address,
  };
}
