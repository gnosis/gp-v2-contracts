import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

import { domain } from "../src/ts";

describe("GPv2Settlement", () => {
  let settlement: Contract;

  beforeEach(async () => {
    const GPv2Settlement = await ethers.getContractFactory(
      "GPv2SettlementTestInterface",
    );

    settlement = await GPv2Settlement.deploy();
  });

  describe("domainSeparator", () => {
    it("should have an EIP-712 domain separator", async () => {
      const { chainId } = await waffle.provider.getNetwork();

      expect(chainId).to.not.equal(ethers.constants.Zero);
      expect(await settlement.domainSeparatorTest()).to.equal(
        ethers.utils._TypedDataEncoder.hashDomain(
          domain(chainId, settlement.address),
        ),
      );
    });

    it("should have a different replay protection for each deployment", async () => {
      const GPv2Settlement = await ethers.getContractFactory(
        "GPv2SettlementTestInterface",
      );
      const settlement2 = await GPv2Settlement.deploy();

      expect(await settlement.domainSeparatorTest()).to.not.equal(
        await settlement2.domainSeparatorTest(),
      );
    });
  });
});
