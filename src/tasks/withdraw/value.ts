import WethNetworks from "canonical-weth/networks.json";
import { BigNumber, constants } from "ethers";

import { ApiError, estimateTradeAmount } from "../../services/api";
import { OrderKind } from "../../ts";
import { SupportedNetwork } from "../ts/deployment";
import { TokenDetails } from "../ts/erc20";

interface PricedToken extends TokenDetails {
  // Overrides existing field in TokenDetails. The number of decimals must be
  // known to estimate the price
  decimals: number;
  // Amount of DAI wei equivalent to one unit of this token (10**decimals)
  usdValue: BigNumber;
}

const NATIVE_TOKEN_SYMBOL: Record<SupportedNetwork, string> = {
  mainnet: "ETH",
  rinkeby: "ETH",
  xdai: "xDAI",
};

const WRAPPED_NATIVE_TOKEN_ADDRESS: Record<SupportedNetwork, string> = {
  mainnet: WethNetworks.WETH9[1].address,
  rinkeby: WethNetworks.WETH9[4].address,
  xdai: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
};

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
  token: Pick<TokenDetails, "symbol" | "address"> | "native token",
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
    return await estimateTradeAmount({
      sellToken: token.address,
      buyToken: REFERENCE_TOKEN[network].address,
      amount,
      kind: OrderKind.SELL,
      network,
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
  token: TokenDetails,
  network: SupportedNetwork,
): Promise<PricedToken> {
  const decimals = token.decimals ?? 18;
  const usd = await usdValue(token, BigNumber.from(10).pow(decimals), network);
  return { ...token, usdValue: usd, decimals };
}
