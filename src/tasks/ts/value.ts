import { BigNumber, constants } from "ethers";

import { Api, ApiError, CallError } from "../../services/api";
import { OrderKind } from "../../ts";
import { SupportedNetwork } from "../ts/deployment";
import { Erc20Token, WRAPPED_NATIVE_TOKEN_ADDRESS } from "../ts/tokens";

interface PricedToken extends Erc20Token {
  // Overrides existing field in TokenDetails. The number of decimals must be
  // known to estimate the price
  decimals: number;
  // Amount of DAI wei equivalent to one unit of this token (10**decimals)
  usdValue: BigNumber;
}

export interface ReferenceToken {
  symbol: string;
  decimals: number;
  address: string;
}
export const REFERENCE_TOKEN: Record<SupportedNetwork, ReferenceToken> = {
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
  token: Pick<Erc20Token, "symbol" | "address">,
  amount: BigNumber,
  referenceToken: ReferenceToken,
  api: Api,
): Promise<BigNumber> {
  try {
    return await api.estimateTradeAmount({
      sellToken: token.address,
      buyToken: referenceToken.address,
      amount,
      kind: OrderKind.SELL,
    });
  } catch (e) {
    if (!(e instanceof Error)) {
      throw e;
    }
    const errorData: ApiError = (e as CallError).apiError ?? {
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
  usdReference: ReferenceToken,
): string {
  return formatTokenValue(amount, usdReference.decimals, 2);
}

export async function appraise(
  token: Erc20Token,
  usdReference: ReferenceToken,
  api: Api,
): Promise<PricedToken> {
  const decimals = token.decimals ?? 18;
  const usd = await usdValue(
    token,
    BigNumber.from(10).pow(decimals),
    usdReference,
    api,
  );
  return { ...token, usdValue: usd, decimals };
}
