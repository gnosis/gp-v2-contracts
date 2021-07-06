import { Order, OrderKind } from "@gnosis.pm/gp-v2-contracts";
import { BigNumber } from "ethers";
import fetch, { RequestInit } from "node-fetch";

import { Signature } from "./utils";

export class Api {
  network: string;

  constructor(network: string) {
    this.network = network;
  }

  private async call<T>(route: string, init?: RequestInit): Promise<T> {
    const url = `https://protocol-${this.network}.dev.gnosisdev.com/api/v1/${route}`;
    const response = await fetch(url, init);
    const body = await response.text();
    if (!response.ok) {
      throw `Calling "${url} ${JSON.stringify(init)} failed with ${
        response.status
      }: ${body}`;
    }
    return JSON.parse(body);
  }

  async getFee(
    selToken: string,
    buyToken: string,
    amount: BigNumber,
    kind: OrderKind
  ): Promise<BigNumber> {
    const response: GetFeeResponse = await this.call(
      `fee?sellToken=${selToken}&buyToken=${buyToken}&amount=${amount}&kind=${kind}`
    );
    return BigNumber.from(response.amount);
  }

  async estimateTradeAmount(
    selToken: string,
    buyToken: string,
    amount: BigNumber,
    kind: OrderKind
  ): Promise<BigNumber> {
    const response: EstimateAmountResponse = await this.call(
      `markets/${selToken}-${buyToken}/${kind}/${amount}`
    );
    return BigNumber.from(response.amount);
  }

  async placeOrder(order: Order, signature: Signature): Promise<string> {
    return await this.call("orders", {
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
        signature: signature.signature,
        signingScheme: signature.signatureScheme,
        receiver: order.receiver,
      }),
      headers: { "Content-Type": "application/json" },
    });
  }

  async getExecutedSellAmount(uid: string): Promise<BigNumber> {
    const response: OrderDetailResponse = await this.call(`orders/${uid}`);
    return BigNumber.from(response.executedSellAmount);
  }
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
