import axios from "axios";
import { BigNumber, constants } from "ethers";

import { OrderKind } from "../../ts";
import { TokenDetails } from "../ts/erc20";

interface ApiTradeQuery {
  network: string;
  baseToken: string;
  quoteToken: string;
  kind: OrderKind;
  amount: BigNumber;
}

interface PricedToken extends TokenDetails {
  // Overrides existing field in TokenDetails. The number of decimals must be
  // known to estimate the price
  decimals: number;
  // Amount of DAI wei equivalent to one unit of this token (10**decimals)
  usdValue: BigNumber;
}

const REFERENCE_TOKEN: Record<
  string,
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
    address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
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
  token: Pick<TokenDetails, "symbol" | "address">,
  amount: BigNumber,
  network: string,
): Promise<BigNumber> {
  if (!(network in REFERENCE_TOKEN)) {
    throw new Error("Unsupported network for computing USD value");
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
    return BigNumber.from(response.data.amount);
  } catch (e) {
    console.warn(
      `Warning: price retrieval failed for token ${token.symbol} (${token.address}).`,
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

export function formatUsdValue(amount: BigNumber, network: string): string {
  if (!(network in REFERENCE_TOKEN)) {
    throw new Error("Network not supported");
  }
  return formatTokenValue(amount, REFERENCE_TOKEN[network].decimals, 2);
}

export async function appraise(
  token: TokenDetails,
  network: string,
): Promise<PricedToken> {
  const decimals = token.decimals ?? 18;
  const usd = await usdValue(token, BigNumber.from(10).pow(decimals), network);
  return { ...token, usdValue: usd, decimals };
}
