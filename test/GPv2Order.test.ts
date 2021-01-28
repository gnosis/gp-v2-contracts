import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import { ethers } from "hardhat";

import { ORDER_UID_LENGTH, computeOrderUid } from "../src/ts";

function fillDistinctBytes(count: number, start: number): string {
  return ethers.utils.hexlify(
    [...Array(count)].map((_, i) => (start + i) % 256),
  );
}

describe("GPv2Order", () => {
  let orders: Contract;

  beforeEach(async () => {
    const GPv2Order = await ethers.getContractFactory("GPv2OrderTestInterface");
    orders = await GPv2Order.deploy();
  });

  describe("extractOrderUidParams", () => {
    it("round trip encode/decode", async () => {
      // Start from 1 so no bytes zeroes.
      const orderDigest = fillDistinctBytes(32, 1);
      const address = ethers.utils.getAddress(fillDistinctBytes(20, 1 + 32));
      const validTo = BigNumber.from(fillDistinctBytes(4, 1 + 32 + 20));

      const orderUid = computeOrderUid({
        orderDigest,
        owner: address,
        validTo: validTo.toNumber(),
      });
      expect(orderUid).to.equal(fillDistinctBytes(32 + 20 + 4, 1));

      const {
        orderDigest: extractedOrderDigest,
        owner: extractedAddress,
        validTo: extractedValidTo,
      } = await orders.extractOrderUidParamsTest(orderUid);
      expect(extractedOrderDigest).to.equal(orderDigest);
      expect(extractedValidTo).to.equal(validTo);
      expect(extractedAddress).to.equal(address);
    });

    describe("fails on uid", () => {
      it("longer than expected", async () => {
        const invalidUid = fillDistinctBytes(ORDER_UID_LENGTH + 1, 0);
        await expect(
          orders.extractOrderUidParamsTest(invalidUid),
        ).to.be.revertedWith("GPv2: invalid uid");
      });

      it("shorter than expected", async () => {
        const invalidUid = fillDistinctBytes(ORDER_UID_LENGTH - 1, 0);
        await expect(
          orders.extractOrderUidParamsTest(invalidUid),
        ).to.be.revertedWith("GPv2: invalid uid");
      });
    });
  });
});
