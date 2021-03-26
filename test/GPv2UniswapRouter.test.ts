import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { Contract, utils } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

function fillAddress(byte: number): string {
  return ethers.utils.hexlify([...Array(20)].map(() => byte));
}

async function interfaceFor(name: string): Promise<utils.Interface> {
  const { abi } = await artifacts.readArtifact(name);
  return new ethers.utils.Interface(abi);
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
      const erc20 = await interfaceFor(
        "src/contracts/interfaces/IERC20.sol:IERC20",
      );
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

  describe("swapInteraction", () => {
    it("should encode a swap for the given tokens and receiver", async () => {
      const uniswapPair = await interfaceFor("IUniswapV2Pair");
      const {
        target,
        value,
        callData,
      } = await uniswapRouter.swapInteractionTest(
        fillAddress(1),
        fillAddress(2),
        ethers.utils.parseEther("1.0"),
        fillAddress(3),
      );

      expect({ target, value, callData }).to.deep.equal({
        target: pairFor(fillAddress(1), fillAddress(2)),
        value: ethers.constants.Zero,
        callData: uniswapPair.encodeFunctionData("swap", [
          ethers.constants.Zero,
          ethers.utils.parseEther("1.0"),
          fillAddress(3),
          "0x",
        ]),
      });
    });

    it("correctly orders the tokens", async () => {
      const uniswapPair = await interfaceFor("IUniswapV2Pair");
      const { callData } = await uniswapRouter.swapInteractionTest(
        // NOTE: `fillAddress(2) > fillAddress(1)`, this means that the pair's
        // `token0` is `tokenOut` in this case.
        fillAddress(2),
        fillAddress(1),
        ethers.utils.parseEther("1.0"),
        fillAddress(3),
      );

      expect(callData).to.deep.equal(
        uniswapPair.encodeFunctionData("swap", [
          ethers.utils.parseEther("1.0"),
          ethers.constants.Zero,
          fillAddress(3),
          "0x",
        ]),
      );
    });
  });
});
