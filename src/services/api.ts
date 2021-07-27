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

interface ApiCall {
  network: string;
  environment: Environment;
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
interface PlaceOrderQuery {
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

interface GetFeeAndQuoteSellOutput {
  feeAmount: BigNumber;
  buyAmountAfterFee: BigNumber;
}
interface GetFeeAndQuoteBuyOutput {
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
  network: string,
  environment: Environment,
  init?: RequestInit,
): Promise<T> {
  let baseUrl: string;
  switch (environment) {
    case Environment.Dev:
      baseUrl = `https://protocol-${network}.dev.gnosisdev.com`;
      break;
    case Environment.Prod:
      baseUrl = `https://protocol-${network}.gnosis.io`;
      break;
  }
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
  network,
  environment,
}: GetFeeQuery & ApiCall): Promise<BigNumber> {
  const response: GetFeeResponse = await call(
    `fee?sellToken=${sellToken}&buyToken=${buyToken}&amount=${BigNumber.from(
      amount,
    ).toString()}&kind=${apiKind(kind)}`,
    network,
    environment,
  );
  return BigNumber.from(response.amount);
}

async function estimateTradeAmount({
  network,
  sellToken,
  buyToken,
  kind,
  amount,
  environment,
}: EstimateTradeAmountQuery & ApiCall): Promise<BigNumber> {
  const response: EstimateAmountResponse = await call(
    `markets/${sellToken}-${buyToken}/${apiKind(kind)}/${BigNumber.from(
      amount,
    ).toString()}`,
    network,
    environment,
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
  network,
  environment,
}: PlaceOrderQuery & ApiCall): Promise<string> {
  const normalizedOrder = normalizeOrder(order);
  return await call("orders", network, environment, {
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
  network,
  environment,
}: GetExecutedSellAmountQuery & ApiCall): Promise<BigNumber> {
  const response: OrderDetailResponse = await call(
    `orders/${uid}`,
    network,
    environment,
  );
  return BigNumber.from(response.executedSellAmount);
}

async function getFeeAndQuoteSell({
  sellToken,
  buyToken,
  sellAmountBeforeFee,
  network,
  environment,
}: GetFeeAndQuoteSellQuery & ApiCall): Promise<GetFeeAndQuoteSellOutput> {
  const response: GetFeeAndQuoteSellResponse = await call(
    `feeAndQuote/sell?sellToken=${sellToken}&buyToken=${buyToken}&sellAmountBeforeFee=${BigNumber.from(
      sellAmountBeforeFee,
    ).toString()}`,
    network,
    environment,
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
  network,
  environment,
}: GetFeeAndQuoteBuyQuery & ApiCall): Promise<GetFeeAndQuoteBuyOutput> {
  const response: GetFeeAndQuoteBuyResponse = await call(
    `feeAndQuote/buy?sellToken=${sellToken}&buyToken=${buyToken}&buyAmountAfterFee=${BigNumber.from(
      buyAmountAfterFee,
    ).toString()}`,
    network,
    environment,
  );
  return {
    feeAmount: BigNumber.from(response.fee.amount),
    sellAmountBeforeFee: BigNumber.from(response.sellAmountBeforeFee),
  };
}

export class Api {
  network: string;
  environment: Environment;

  constructor(network: string, environment: Environment) {
    this.network = network;
    this.environment = environment;
  }

  private apiCallParams() {
    return { network: this.network, environment: this.environment };
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
