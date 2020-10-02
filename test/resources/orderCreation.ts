import { Wallet, Contract, BigNumber } from "ethers";

import { Order } from "../../src/js/orders.spec";

export const orderAlwaysValid = function (
  sellAmount: BigNumber | number,
  buyAmount: BigNumber | number,
  sellToken: Contract,
  buyToken: Contract,
  wallet: Wallet,
  nonce: BigNumber | number,
): Order {
  const orderValidFrom = 0;
  // if validFrom is zero, then the following value is ignored.
  // we set it to zero to save on gas.
  const orderValidUntil = 0;

  return new Order(
    sellAmount,
    buyAmount,
    sellToken,
    buyToken,
    wallet,
    orderValidFrom,
    orderValidUntil,
    nonce,
  );
};
