import { BigNumber, constants } from "ethers";

import { Api, ApiError, Environment } from "../../services/api";
import { OrderKind } from "../../ts";
import { SupportedNetwork } from "../ts/deployment";
import {
  NATIVE_TOKEN_SYMBOL,
  Erc20Token,
  WRAPPED_NATIVE_TOKEN_ADDRESS,
} from "../ts/tokens";

interface PricedToken extends Erc20Token {
  // Overrides existing field in TokenDetails. The number of decimals must be
  // known to estimate the price
  decimals: number;
  // Amount of DAI wei equivalent to one unit of this token (10**decimals)
  usdValue: BigNumber;
}

const REFERENCE_TOKEN: Record<
  SupportedNetwork,
  { symbol: string; decimals: number; address: string }
> = {
  rinkeby: {
    symbol: "DAI",
    decimals: 18,
    address: "0x5592ec0cfb4dbc12d3ab100b257153436a1f0fea",
  },
  mainnet: {
    symbol: "DAI",
    decimals: 18,
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
  },
  xdai: {
    // todo: replace with XDAI when native token price queries will be supported
    // by the services.
    symbol: "WXDAI",
    decimals: 18,
    address: WRAPPED_NATIVE_TOKEN_ADDRESS.xdai,
  },
} as const;

export const usdValue = async function (
  token: Pick<Erc20Token, "symbol" | "address"> | "native token",
  amount: BigNumber,
  network: SupportedNetwork,
): Promise<BigNumber> {
  if (token === "native token") {
    // Note: using wrapped token since the API does not support sell orders in
    // native tokens.
    token = {
      symbol: NATIVE_TOKEN_SYMBOL[network],
      address: WRAPPED_NATIVE_TOKEN_ADDRESS[network],
    };
  }
  try {
    return await new Api(network, Environment.Prod).estimateTradeAmount({
      sellToken: token.address,
      buyToken: REFERENCE_TOKEN[network].address,
      amount,
      kind: OrderKind.SELL,
    });
  } catch (e) {
    const errorData: ApiError = e.apiError ?? {
      errorType: "script internal error",
      description: e?.message ?? "no details",
    };
    console.warn(
      `Warning: price retrieval failed for token ${token.symbol} (${token.address}): ${errorData.errorType} (${errorData.description})`,
    );
    return constants.Zero;
  }
};

// Format amount so that it has exactly a fixed amount of decimals.
export function formatTokenValue(
  amount: BigNumber,
  actualDecimals: number,
  targetDecimals: number,
): string {
  const normalized =
    targetDecimals <= actualDecimals
      ? amount.div(BigNumber.from(10).pow(actualDecimals - targetDecimals))
      : amount.mul(BigNumber.from(10).pow(-actualDecimals + targetDecimals));
  const powDecimals = BigNumber.from(10).pow(targetDecimals);
  return `${normalized.div(powDecimals).toString()}.${normalized
    .mod(powDecimals)
    .toString()
    .padStart(targetDecimals, "0")}`;
}

export function formatUsdValue(
  amount: BigNumber,
  network: SupportedNetwork,
): string {
  return formatTokenValue(amount, REFERENCE_TOKEN[network].decimals, 2);
}

export async function appraise(
  token: Erc20Token,
  network: SupportedNetwork,
): Promise<PricedToken> {
  const decimals = token.decimals ?? 18;
  const usd = await usdValue(token, BigNumber.from(10).pow(decimals), network);
  return { ...token, usdValue: usd, decimals };
}
