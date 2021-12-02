import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

describe("StorageAccessible", () => {
  const decodeUint = (data: string) => {
    const [value] = ethers.utils.defaultAbiCoder.decode(["uint256"], data);
    return value as BigNumber;
  };

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

  describe("simulateDelegatecall", async () => {
    it("can invoke a function in the context of a previously deployed contract", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      // Deploy and use reader contract to access foo
      const reader = await ExternalStorageReader.deploy();
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      const result = await instance.callStatic.simulateDelegatecall(
        reader.address,
        getFooCall,
      );
      expect(decodeUint(result)).to.equal(42);
    });

    it("can simulateDelegatecall a function with side effects (without executing)", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      // Deploy and use reader contract to simulateDelegatecall setting foo
      const reader = await ExternalStorageReader.deploy();
      const replaceFooCall = reader.interface.encodeFunctionData(
        "setAndGetFoo",
        [69],
      );
      let result = await instance.callStatic.simulateDelegatecall(
        reader.address,
        replaceFooCall,
      );
      expect(decodeUint(result)).to.equal(69);

      // Make sure foo is not actually changed
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      result = await instance.callStatic.simulateDelegatecall(
        reader.address,
        getFooCall,
      );
      expect(decodeUint(result)).to.equal(42);
    });

    it("can simulateDelegatecall a function that reverts", async () => {
      const instance = await StorageAccessibleWrapper.deploy();

      const reader = await ExternalStorageReader.deploy();
      const doRevertCall = reader.interface.encodeFunctionData("doRevert");
      await expect(
        instance.callStatic.simulateDelegatecall(reader.address, doRevertCall),
      ).to.be.reverted;
    });

    it("allows detection of reverts when invoked from other smart contract", async () => {
      const instance = await StorageAccessibleWrapper.deploy();

      const reader = await ExternalStorageReader.deploy();
      await expect(reader.invokeDoRevertViaStorageAccessible(instance.address))
        .to.be.reverted;
    });
  });
});
