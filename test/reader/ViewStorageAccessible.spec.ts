import { expect } from "chai";
import { ContractFactory } from "ethers";
import { ethers } from "hardhat";

describe("ViewStorageAccessible", () => {
  let StorageAccessibleWrapper: ContractFactory;
  let ExternalStorageReader: ContractFactory;

  before(async () => {
    StorageAccessibleWrapper = await ethers.getContractFactory(
      "StorageAccessibleWrapper",
    );
    ExternalStorageReader = await ethers.getContractFactory(
      "ExternalStorageReader",
    );
  });

  describe("simulate", () => {
    it("can be called from a static context", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      const reader = await ExternalStorageReader.deploy();
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      // invokeStaticDelegatecall is marked as view
      const result = await reader.invokeStaticDelegatecall(
        instance.address,
        getFooCall,
      );
      expect(result).to.equal(42);
    });

    it("cannot simulate state changes", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      const reader = await ExternalStorageReader.deploy();
      const replaceFooCall = reader.interface.encodeFunctionData(
        "setAndGetFoo",
        [69],
      );
      await expect(
        reader.invokeStaticDelegatecall(reader.address, replaceFooCall),
      ).to.be.reverted;
    });
  });
});
