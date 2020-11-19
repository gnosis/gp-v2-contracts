import { ethers, waffle } from "hardhat";

import { SettlementEncoder, SigningScheme, OrderKind } from "../src/ts";

const ORDER_COUNTS = [1, 5, 10, 25, 50, 100];

async function main() {
  const [deployer, ...traders] = waffle.provider.getWallets();

  const GPv2Encoding = await ethers.getContractFactory(
    "GPv2EncodingTestInterface",
    deployer,
  );
  const encoding = await GPv2Encoding.deploy();

  for (const orderCount of ORDER_COUNTS) {
    const encoder = new SettlementEncoder({ name: "test" });
    for (let i = 0; i < orderCount; i++) {
      await encoder.signEncodeTrade(
        {
          sellToken: `0x${"55".repeat(20)}`,
          buyToken: `0x${"bb".repeat(20)}`,
          sellAmount: ethers.utils.parseEther("42"),
          buyAmount: ethers.utils.parseEther("13.37"),
          validTo: 0xffffffff,
          nonce: i,
          tip: ethers.constants.WeiPerEther,
          kind: OrderKind.SELL,
          partiallyFillable: false,
        },
        ethers.utils.parseEther("42"),
        traders[i % traders.length],
        SigningScheme.TYPED_DATA,
      );
    }

    const [, , gas] = await encoding.decodeTradesTest(
      encoder.tokens,
      encoder.tradeCount,
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
