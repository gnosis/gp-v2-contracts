import { Wallet, Contract, BigNumber } from "ethers";

import { Order } from "../../src/js/orders.spec";

export function indefiniteOrder(
  sellAmount: BigNumber | number,
  buyAmount: BigNumber | number,
  sellToken: Contract,
  buyToken: Contract,
  wallet: Wallet,
  nonce: BigNumber | number,
): Order {
  const beginningOfTime = 0;
  const endOfTime = 2 ** 32 - 1;

  return new Order(
    sellAmount,
    buyAmount,
    sellToken,
    buyToken,
    wallet,
    beginningOfTime,
    endOfTime,
    nonce,
  );
}
