import axios from "axios";
import { BigNumber, constants } from "ethers";

import { OrderKind } from "../../ts";
import { SupportedNetwork } from "../ts/deployment";
import {
  NATIVE_TOKEN_SYMBOL,
  Erc20Token,
  WRAPPED_NATIVE_TOKEN_ADDRESS,
} from "../ts/tokens";

interface ApiTradeQuery {
  network: string;
  baseToken: string;
  quoteToken: string;
  kind: OrderKind;
  amount: BigNumber;
}

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

function apiPriceUrl({
  network,
  baseToken,
  quoteToken,
  kind,
  amount,
}: ApiTradeQuery) {
  // Using dev endpoint to avoid stressing the prod server with too many queries
  return `https://protocol-${network}.dev.gnosisdev.com/api/v1/markets/${baseToken}-${quoteToken}/${kind}/${amount.toString()}`;
}

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
    const response = await axios.get(
      apiPriceUrl({
        baseToken: token.address,
        quoteToken: REFERENCE_TOKEN[network].address,
        kind: OrderKind.SELL,
        amount,
        network,
      }),
    );
    // The services return the quote token used for the price. The quote token
    // is checked to make sure that the returned price meets our expectations.
    if (
      response.data.token.toLowerCase() !==
      REFERENCE_TOKEN[network].address.toLowerCase()
    ) {
      console.warn(
        `Warning: price returned for base token ${token.symbol} (${token.address}) uses an incorrect quote token (${response.data.token} instead of ${REFERENCE_TOKEN[network].address}); price is set to zero`,
      );
      return constants.Zero;
    }
    return BigNumber.from(response.data.amount);
  } catch (e) {
    const errorData = e.response?.data ?? {
      errorType: "UnknownError",
      description: "no error from server",
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
