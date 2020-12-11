import { ethers } from "hardhat";

import {
  SettlementEncoder,
  SigningScheme,
  OrderKind,
  isTypedDataSigner,
} from "../src/ts";

const ORDER_COUNTS = [1, 5, 10, 25, 50, 100];

async function main() {
  const [deployer, ...traders] = await ethers.getSigners();

  const GPv2Encoding = await ethers.getContractFactory(
    "GPv2EncodingTestInterface",
    deployer,
  );
  const encoding = await GPv2Encoding.deploy();

  for (const orderCount of ORDER_COUNTS) {
    const encoder = new SettlementEncoder({ name: "test" });
    for (let i = 0; i < orderCount; i++) {
      const trader = traders[i % traders.length];
      await encoder.signEncodeTrade(
        {
          sellToken: `0x${"55".repeat(20)}`,
          buyToken: `0x${"bb".repeat(20)}`,
          sellAmount: ethers.utils.parseEther("42"),
          buyAmount: ethers.utils.parseEther("13.37"),
          validTo: 0xffffffff,
          appData: i,
          feeAmount: ethers.constants.WeiPerEther,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        trader,
        isTypedDataSigner(trader)
          ? SigningScheme.TYPED_DATA
          : SigningScheme.MESSAGE,
        { executedAmount: ethers.utils.parseEther("42") },
      );
    }

    const [, , gas] = await encoding.decodeTradesTest(
      encoder.tokens,
      encoder.encodedTrades,
    );
    console.log(`${gas} gas used for decoding ${orderCount} orders`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
