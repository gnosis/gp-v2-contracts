import { expect } from "chai";
import { constants, Contract, utils } from "ethers";
import hre, { ethers, waffle, artifacts } from "hardhat";

import {
  transfer,
  balanceOf,
  nativeToken,
  erc20Token,
  isNativeToken,
  Erc20Token,
  NativeToken,
} from "../../../src/tasks/ts/tokens";

describe("token tools", () => {
  const [deployer, user] = waffle.provider.getWallets();
  const receiver = "0x" + "42".repeat(20);

  let token: Contract;
  let erc20: Erc20Token;
  let native: NativeToken;

  beforeEach(async () => {
    const IERC20 = await artifacts.readArtifact(
      "src/contracts/interfaces/IERC20.sol:IERC20",
    );

    token = await waffle.deployMockContract(deployer, IERC20.abi);

    const recoveredErc20 = await erc20Token(token.address, hre);
    if (recoveredErc20 === null) {
      throw new Error("Erc20 token not decoded");
    }
    erc20 = recoveredErc20;
    native = await nativeToken(hre);
  });

  describe("erc20Token", () => {
    it("recovers token info", async () => {
      await token.mock.symbol.withArgs().returns("SYM");
      await token.mock.decimals.withArgs().returns(18);

      const recoveredErc20 = await erc20Token(token.address, hre);
      expect(recoveredErc20).not.to.be.null;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      erc20 = recoveredErc20!;

      expect(erc20.address).to.equal(token.address);
      expect(erc20.symbol).to.equal("SYM");
      expect(erc20.decimals).to.equal(18);
    });

    it("returns null for addresses with no code", async () => {
      expect(await erc20Token(constants.AddressZero, hre)).to.be.null;
    });
  });

  it("isNativeToken", async () => {
    expect(await isNativeToken(erc20)).to.be.false;
    expect(await isNativeToken(native)).to.be.true;
  });

  describe("balance", () => {
    it("erc20", async () => {
      const balance = utils.parseEther("13.37");
      await token.mock.balanceOf.withArgs(user.address).returns(balance);

      expect(await balanceOf(erc20, user.address)).to.deep.equal(balance);
    });

    it("native token", async () => {
      const value = utils.parseEther("13.37");
      await user.sendTransaction({ to: constants.AddressZero, value });

      expect(await balanceOf(native, constants.AddressZero)).to.deep.equal(
        value,
      );
    });
  });

  describe("transfer", () => {
    it("erc20", async () => {
      const amount = utils.parseEther("13.37");
      await token.mock.transfer.withArgs(receiver, amount).returns(true);

      await transfer(erc20, user, receiver, amount);
      expect(await ethers.provider.getBalance(receiver)).to.deep.equal(
        constants.Zero,
      );
    });

    it("native token", async () => {
      const amount = utils.parseEther("13.37");

      await transfer(native, user, receiver, amount);
      expect(await ethers.provider.getBalance(receiver)).to.deep.equal(amount);
    });
  });
});
