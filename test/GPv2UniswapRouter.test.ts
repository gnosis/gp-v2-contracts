import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

function fillAddress(byte: number): string {
  return ethers.utils.hexlify([...Array(20)].map(() => byte));
}

describe("GPv2UniswapRouter", () => {
  const [deployer] = waffle.provider.getWallets();

  let settlement: MockContract;
  let uniswapFactory: MockContract;
  let uniswapRouter: Contract;

  beforeEach(async () => {
    const GPv2Settlement = await artifacts.readArtifact("GPv2Settlement");
    settlement = await waffle.deployMockContract(deployer, GPv2Settlement.abi);

    const UniswapV2Factory = await artifacts.readArtifact("IUniswapV2Factory");
    uniswapFactory = await waffle.deployMockContract(
      deployer,
      UniswapV2Factory.abi,
    );
    await uniswapFactory.mock.getPair.returns(ethers.constants.AddressZero);

    const GPv2UniswapRouter = await ethers.getContractFactory(
      "GPv2UniswapRouterTestInterface",
    );
    uniswapRouter = await GPv2UniswapRouter.deploy(
      settlement.address,
      uniswapFactory.address,
    );
  });

  describe("settlement", () => {
    it("should be set", async () => {
      expect(await uniswapRouter.settlement()).to.equal(settlement.address);
    });
  });

  describe("factory", () => {
    it("should be set", async () => {
      expect(await uniswapRouter.factory()).to.equal(uniswapFactory.address);
    });
  });

  function pairFor(tokenA: string, tokenB: string): string {
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

    return ethers.utils.getAddress(
      ethers.utils.hexDataSlice(
        ethers.utils.solidityKeccak256(
          ["bytes1", "address", "bytes32", "bytes32"],
          [
            "0xff",
            uniswapFactory.address,
            ethers.utils.solidityKeccak256(
              ["address", "address"],
              [token0, token1],
            ),
            "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f",
          ],
        ),
        12,
      ),
    );
  }

  describe("transferInteraction", () => {
    it("should encode a transfer for the first swap amount of the first token", async () => {
      const erc20 = new ethers.utils.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);

      const {
        target,
        value,
        callData,
      } = await uniswapRouter.transferInteractionTest(
        [fillAddress(1), fillAddress(2), fillAddress(3)],
        [ethers.utils.parseEther("1.0"), ethers.utils.parseEther("2.0")],
      );

      expect({ target, value, callData }).to.deep.equal({
        target: fillAddress(1),
        value: ethers.constants.Zero,
        callData: erc20.encodeFunctionData("transfer", [
          pairFor(fillAddress(1), fillAddress(2)),
          ethers.utils.parseEther("1.0"),
        ]),
      });
    });
  });
});
