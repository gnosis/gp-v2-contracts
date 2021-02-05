import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, waffle } from "hardhat";

describe("GPv2Interaction", () => {
  const [deployer, trader] = waffle.provider.getWallets();
  let interactions: Contract;

  beforeEach(async () => {
    const GPv2Interaction = await ethers.getContractFactory(
      "GPv2InteractionTestInterface",
    );
    interactions = await GPv2Interaction.deploy();
  });

  describe("execute", () => {
    it("should pass on successful execution", async () => {
      await expect(
        interactions.executeTest({
          target: ethers.constants.AddressZero,
          callData: "0x",
          value: 0,
        }),
      ).to.not.be.reverted;
    });

    it("should revert when interaction reverts", async () => {
      const reverter = await waffle.deployMockContract(deployer, [
        "function alwaysReverts()",
      ]);
      await reverter.mock.alwaysReverts.revertsWithReason("test error");

      await expect(
        interactions.executeTest({
          target: reverter.address,
          value: 0,
          callData: reverter.interface.encodeFunctionData("alwaysReverts"),
        }),
      ).to.be.revertedWith("test error");
    });

    it("should send Ether when value is specified", async () => {
      const { getBalance } = ethers.provider;

      const target = await waffle.deployMockContract(deployer, [
        "function someFunction()",
      ]);
      await target.mock.someFunction.returns();

      expect(await getBalance(target.address)).to.equal(ethers.constants.Zero);

      const value = ethers.utils.parseEther("1.0");
      await deployer.sendTransaction({
        to: interactions.address,
        value,
      });
      expect(await getBalance(interactions.address)).to.equal(value);

      await interactions.executeTest({
        target: target.address,
        value,
        callData: target.interface.encodeFunctionData("someFunction"),
      });

      expect(await getBalance(target.address)).to.equal(value);
      expect(await getBalance(interactions.address)).to.equal(
        ethers.constants.Zero,
      );
    });

    it("should send Ether to EOAs", async () => {
      const { getBalance } = ethers.provider;

      const initialBalance = await getBalance(trader.address);

      const value = ethers.utils.parseEther("1.0");
      await deployer.sendTransaction({
        to: interactions.address,
        value,
      });
      expect(await getBalance(interactions.address)).to.equal(value);

      await interactions.executeTest({
        target: trader.address,
        value,
        callData: "0x",
      });

      expect(await getBalance(trader.address)).to.equal(
        initialBalance.add(value),
      );
      expect(await getBalance(interactions.address)).to.equal(
        ethers.constants.Zero,
      );
    });

    it("should revert when sending Ether to non-payable contracts", async () => {
      const NonPayable = await ethers.getContractFactory("NonPayable");
      const target = await NonPayable.deploy();

      await expect(
        interactions.executeTest({
          target: target.address,
          value: 0,
          callData: "0x",
        }),
      ).to.not.be.reverted;

      const value = ethers.utils.parseEther("1.0");
      await deployer.sendTransaction({
        to: interactions.address,
        value,
      });
      expect(await ethers.provider.getBalance(interactions.address)).to.equal(
        value,
      );
      await expect(
        interactions.executeTest({
          target: target.address,
          value,
          callData: "0x",
        }),
      ).to.be.reverted;
    });
  });

  describe("selector", () => {
    it("masks the function selector to the first 4 bytes for the emitted event", async () => {
      const abi = new ethers.utils.Interface([
        "function someFunction(bytes32 parameter)",
      ]);

      expect(
        await interactions.selectorTest({
          target: ethers.constants.AddressZero,
          value: 0,
          callData: abi.encodeFunctionData("someFunction", [
            `0x${"ff".repeat(32)}`,
          ]),
        }),
      ).to.equal(abi.getSighash("someFunction"));
    });

    it("computes selector for parameterless functions", async () => {
      const abi = new ethers.utils.Interface(["function someFunction()"]);

      expect(
        await interactions.selectorTest({
          target: ethers.constants.AddressZero,
          value: 0,
          callData: abi.encodeFunctionData("someFunction"),
        }),
      ).to.equal(abi.getSighash("someFunction"));
    });

    it("uses 0 selector for empty or short calldata", async () => {
      for (const callData of ["0x", "0xabcdef"]) {
        expect(
          await interactions.selectorTest({
            target: ethers.constants.AddressZero,
            value: ethers.constants.Zero,
            callData,
          }),
        ).to.equal("0x00000000");
      }
    });
  });
});
