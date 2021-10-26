import { BigNumber, BigNumberish } from "ethers";
import fetch, { RequestInit } from "node-fetch";

import {
  normalizeOrder,
  Order,
  OrderKind,
  Signature,
  SigningScheme,
  encodeSignatureData,
} from "../ts";

export enum Environment {
  Dev,
  Prod,
}

export function apiUrl(environment: Environment, network: string): string {
  switch (environment) {
    case Environment.Dev:
      return `https://protocol-${network}.dev.gnosisdev.com`;
    case Environment.Prod:
      return `https://protocol-${network}.gnosis.io`;
    default:
      throw new Error("Invalid environment");
  }
}

interface ApiCall {
  baseUrl: string;
}

interface GetFeeQuery {
  sellToken: string;
  buyToken: string;
  kind: OrderKind;
  amount: BigNumberish;
}
interface EstimateTradeAmountQuery {
  sellToken: string;
  buyToken: string;
  kind: OrderKind;
  amount: BigNumberish;
}
export interface PlaceOrderQuery {
  order: Order;
  signature: Signature;
}
interface GetExecutedSellAmountQuery {
  uid: string;
}
interface GetFeeAndQuoteSellQuery {
  sellToken: string;
  buyToken: string;
  sellAmountBeforeFee: BigNumberish;
}
interface GetFeeAndQuoteBuyQuery {
  sellToken: string;
  buyToken: string;
  buyAmountAfterFee: BigNumberish;
}

interface OrderDetailResponse {
  // Other fields are omitted until needed
  executedSellAmount: string;
}
interface GetFeeResponse {
  amount: string;
  expirationDate: Date;
}
interface EstimateAmountResponse {
  amount: string;
  token: string;
}
interface GetFeeAndQuoteSellResponse {
  fee: GetFeeResponse;
  buyAmountAfterFee: BigNumberish;
}
interface GetFeeAndQuoteBuyResponse {
  fee: GetFeeResponse;
  sellAmountBeforeFee: BigNumberish;
}

export interface GetFeeAndQuoteSellOutput {
  feeAmount: BigNumber;
  buyAmountAfterFee: BigNumber;
}
export interface GetFeeAndQuoteBuyOutput {
  feeAmount: BigNumber;
  sellAmountBeforeFee: BigNumber;
}

export interface ApiError {
  errorType: string;
  description: string;
}
export interface CallError extends Error {
  apiError?: ApiError;
}

export enum GetFeeAndQuoteSellErrorType {
  SellAmountDoesNotCoverFee = "SellAmountDoesNotCoverFee",
  // other errors are added when necessary
}

function apiKind(kind: OrderKind): string {
  switch (kind) {
    case OrderKind.SELL:
      return "sell";
    case OrderKind.BUY:
      return "buy";
    default:
      throw new Error(`Unsupported kind ${kind}`);
  }
}

function apiSigningScheme(scheme: SigningScheme): string {
  switch (scheme) {
    case SigningScheme.EIP712:
      return "eip712";
    case SigningScheme.ETHSIGN:
      return "ethsign";
    case SigningScheme.EIP1271:
      return "eip1271";
    case SigningScheme.PRESIGN:
      return "presign";
    default:
      throw new Error(`Unsupported signing scheme ${scheme}`);
  }
}

async function call<T>(
  route: string,
  baseUrl: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${baseUrl}/api/v1/${route}`;
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    const error: CallError = new Error(
      `Calling "${url} ${JSON.stringify(init)} failed with ${
        response.status
      }: ${body}`,
    );
    try {
      error.apiError = JSON.parse(body);
    } catch {
      // no api error
    }
    throw error;
  }
  return JSON.parse(body);
}

async function getFee({
  sellToken,
  buyToken,
  kind,
  amount,
  baseUrl,
}: GetFeeQuery & ApiCall): Promise<BigNumber> {
  const response: GetFeeResponse = await call(
    `fee?sellToken=${sellToken}&buyToken=${buyToken}&amount=${BigNumber.from(
      amount,
    ).toString()}&kind=${apiKind(kind)}`,
    baseUrl,
  );
  return BigNumber.from(response.amount);
}

async function estimateTradeAmount({
  sellToken,
  buyToken,
  kind,
  amount,
  baseUrl,
}: EstimateTradeAmountQuery & ApiCall): Promise<BigNumber> {
  const response: EstimateAmountResponse = await call(
    `markets/${sellToken}-${buyToken}/${apiKind(kind)}/${BigNumber.from(
      amount,
    ).toString()}`,
    baseUrl,
  );
  // The services return the quote token used for the price. The quote token
  // is checked to make sure that the returned price meets our expectations.
  if (response.token.toLowerCase() !== buyToken.toLowerCase()) {
    throw new Error(
      `Price returned for sell token ${sellToken} uses an incorrect quote token (${response.token.toLowerCase()} instead of ${buyToken.toLowerCase()})`,
    );
  }
  return BigNumber.from(response.amount);
}

async function placeOrder({
  order,
  signature,
  baseUrl,
}: PlaceOrderQuery & ApiCall): Promise<string> {
  const normalizedOrder = normalizeOrder(order);
  return await call("orders", baseUrl, {
    method: "post",
    body: JSON.stringify({
      sellToken: normalizedOrder.sellToken,
      buyToken: normalizedOrder.buyToken,
      sellAmount: BigNumber.from(normalizedOrder.sellAmount).toString(),
      buyAmount: BigNumber.from(normalizedOrder.buyAmount).toString(),
      validTo: normalizedOrder.validTo,
      appData: normalizedOrder.appData,
      feeAmount: BigNumber.from(normalizedOrder.feeAmount).toString(),
      kind: apiKind(order.kind),
      partiallyFillable: normalizedOrder.partiallyFillable,
      signature: encodeSignatureData(signature),
      signingScheme: apiSigningScheme(signature.scheme),
      receiver: normalizedOrder.receiver,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

async function getExecutedSellAmount({
  uid,
  baseUrl,
}: GetExecutedSellAmountQuery & ApiCall): Promise<BigNumber> {
  const response: OrderDetailResponse = await call(`orders/${uid}`, baseUrl);
  return BigNumber.from(response.executedSellAmount);
}

async function getFeeAndQuoteSell({
  sellToken,
  buyToken,
  sellAmountBeforeFee,
  baseUrl,
}: GetFeeAndQuoteSellQuery & ApiCall): Promise<GetFeeAndQuoteSellOutput> {
  const response: GetFeeAndQuoteSellResponse = await call(
    `feeAndQuote/sell?sellToken=${sellToken}&buyToken=${buyToken}&sellAmountBeforeFee=${BigNumber.from(
      sellAmountBeforeFee,
    ).toString()}`,
    baseUrl,
  );
  return {
    feeAmount: BigNumber.from(response.fee.amount),
    buyAmountAfterFee: BigNumber.from(response.buyAmountAfterFee),
  };
}

async function getFeeAndQuoteBuy({
  sellToken,
  buyToken,
  buyAmountAfterFee,
  baseUrl,
}: GetFeeAndQuoteBuyQuery & ApiCall): Promise<GetFeeAndQuoteBuyOutput> {
  const response: GetFeeAndQuoteBuyResponse = await call(
    `feeAndQuote/buy?sellToken=${sellToken}&buyToken=${buyToken}&buyAmountAfterFee=${BigNumber.from(
      buyAmountAfterFee,
    ).toString()}`,
    baseUrl,
  );
  return {
    feeAmount: BigNumber.from(response.fee.amount),
    sellAmountBeforeFee: BigNumber.from(response.sellAmountBeforeFee),
  };
}

export class Api {
  network: string;
  baseUrl: string;

  constructor(network: string, baseUrlOrEnv: string | Environment) {
    this.network = network;
    let baseUrl;
    if (typeof baseUrlOrEnv === "string") {
      baseUrl = baseUrlOrEnv;
    } else {
      baseUrl = apiUrl(baseUrlOrEnv, network);
    }
    this.baseUrl = baseUrl;
  }

  private apiCallParams() {
    return { network: this.network, baseUrl: this.baseUrl };
  }

  async getFee(query: GetFeeQuery): Promise<BigNumber> {
    return getFee({ ...this.apiCallParams(), ...query });
  }
  async estimateTradeAmount(
    query: EstimateTradeAmountQuery,
  ): Promise<BigNumber> {
    return estimateTradeAmount({ ...this.apiCallParams(), ...query });
  }
  async placeOrder(query: PlaceOrderQuery): Promise<string> {
    return placeOrder({ ...this.apiCallParams(), ...query });
  }
  async getExecutedSellAmount(
    query: GetExecutedSellAmountQuery,
  ): Promise<BigNumber> {
    return getExecutedSellAmount({ ...this.apiCallParams(), ...query });
  }
  async getFeeAndQuoteSell(
    query: GetFeeAndQuoteSellQuery,
  ): Promise<GetFeeAndQuoteSellOutput> {
    return getFeeAndQuoteSell({ ...this.apiCallParams(), ...query });
  }
  async getFeeAndQuoteBuy(
    query: GetFeeAndQuoteBuyQuery,
  ): Promise<GetFeeAndQuoteBuyOutput> {
    return getFeeAndQuoteBuy({ ...this.apiCallParams(), ...query });
  }
}
