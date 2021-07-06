import { BigNumber } from "ethers";
import fetch, { RequestInit } from "node-fetch";

import { Order, OrderKind, Signature } from "../ts";

interface ApiCall {
  network: string;
}

interface GetFeeQuery {
  sellToken: string;
  buyToken: string;
  kind: OrderKind;
  amount: BigNumber;
}
interface EstimateTradeAmountQuery {
  sellToken: string;
  buyToken: string;
  kind: OrderKind;
  amount: BigNumber;
}
interface PlaceOrderQuery {
  order: Order;
  signature: Signature;
}
interface GetExecutedSellAmountQuery {
  uid: string;
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
export interface ApiError {
  errorType: string;
  description: string;
}
interface CallError extends Error {
  apiError?: ApiError;
}

async function call<T>(
  route: string,
  network: string,
  init?: RequestInit,
): Promise<T> {
  const url = `https://protocol-${network}.dev.gnosisdev.com/api/v1/${route}`;
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

export async function getFee({
  sellToken,
  buyToken,
  kind,
  amount,
  network,
}: GetFeeQuery & ApiCall): Promise<BigNumber> {
  const response: GetFeeResponse = await call(
    `fee?sellToken=${sellToken}&buyToken=${buyToken}&amount=${amount}&kind=${kind}`,
    network,
  );
  return BigNumber.from(response.amount);
}

export async function estimateTradeAmount({
  network,
  sellToken,
  buyToken,
  kind,
  amount,
}: EstimateTradeAmountQuery & ApiCall): Promise<BigNumber> {
  const response: EstimateAmountResponse = await call(
    `markets/${sellToken}-${buyToken}/${kind}/${amount}`,
    network,
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

export async function placeOrder({
  order,
  signature,
  network,
}: PlaceOrderQuery & ApiCall): Promise<string> {
  return await call("orders", network, {
    method: "post",
    body: JSON.stringify({
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      sellAmount: order.sellAmount.toString(),
      buyAmount: order.buyAmount.toString(),
      validTo: order.validTo,
      appData: order.appData,
      feeAmount: order.feeAmount.toString(),
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      signature: signature.data,
      signingScheme: signature.scheme,
      receiver: order.receiver,
    }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function getExecutedSellAmount({
  uid,
  network,
}: GetExecutedSellAmountQuery & ApiCall): Promise<BigNumber> {
  const response: OrderDetailResponse = await call(`orders/${uid}`, network);
  return BigNumber.from(response.executedSellAmount);
}

export class Api {
  network: string;

  constructor(network: string) {
    this.network = network;
  }

  async getFee(query: GetFeeQuery): Promise<BigNumber> {
    return getFee({ ...query, network: this.network });
  }
  async estimateTradeAmount(
    query: EstimateTradeAmountQuery,
  ): Promise<BigNumber> {
    return estimateTradeAmount({ ...query, network: this.network });
  }
  async placeOrder(query: PlaceOrderQuery): Promise<string> {
    return placeOrder({ ...query, network: this.network });
  }
  async getExecutedSellAmount(
    query: GetExecutedSellAmountQuery,
  ): Promise<BigNumber> {
    return getExecutedSellAmount({ ...query, network: this.network });
  }
}
