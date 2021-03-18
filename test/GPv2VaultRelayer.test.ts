import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { BigNumberish, Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { SwapRequest } from "../src/ts";

const GIVEN_IN = 0;
const GIVEN_OUT = 1;

describe("GPv2VaultRelayer", () => {
  const [
    deployer,
    creator,
    nonCreator,
    ...traders
  ] = waffle.provider.getWallets();

  let vault: MockContract;
  let vaultRelayer: Contract;

  beforeEach(async () => {
    const IVault = await artifacts.readArtifact("IVault");
    vault = await waffle.deployMockContract(deployer, IVault.abi);

    const GPv2VaultRelayer = await ethers.getContractFactory(
      "GPv2VaultRelayer",
      creator,
    );
    vaultRelayer = await GPv2VaultRelayer.deploy(vault.address);
  });

  describe("transferFromAccounts", () => {
    it("should revert if not called by the creator", async () => {
      await expect(
        vaultRelayer.connect(nonCreator).transferFromAccounts([]),
      ).to.be.revertedWith("not creator");
    });

    it("should execute ERC20 and Vault transfers", async () => {
      const tokens = [
        await waffle.deployMockContract(deployer, IERC20.abi),
        await waffle.deployMockContract(deployer, IERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .returns(true);
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: tokens[1].address,
            amount,
            sender: traders[1].address,
            recipient: creator.address,
          },
        ])
        .returns();

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: tokens[0].address,
            amount,
            useInternalBalance: false,
          },
          {
            account: traders[1].address,
            token: tokens[1].address,
            amount,
            useInternalBalance: true,
          },
        ]),
      ).to.not.be.reverted;
    });

    it("should revert on failed ERC20 transfers", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await token.mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .revertsWithReason("test error");

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: token.address,
            amount,
            useInternalBalance: false,
          },
        ]),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed Vault withdrawals", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await vault.mock.withdrawFromInternalBalance
        .withArgs([
          {
            token: token.address,
            amount,
            sender: traders[0].address,
            recipient: creator.address,
          },
        ])
        .revertsWithReason("test error");

      await expect(
        vaultRelayer.transferFromAccounts([
          {
            account: traders[0].address,
            token: token.address,
            amount,
            useInternalBalance: true,
          },
        ]),
      ).to.be.revertedWith("test error");
    });
  });

  describe("batchSwapWithFee", () => {
    interface BatchSwapWithFee {
      kind: typeof GIVEN_IN | typeof GIVEN_OUT;
      swaps: SwapRequest[];
      tokens: string[];
      funds: {
        sender: string;
        fromInternalBalance: boolean;
        recipient: string;
        toInternalBalance: boolean;
      };
      limits: BigNumberish[];
      deadline: number;
      feeTransfer: {
        account: string;
        token: string;
        amount: BigNumberish;
        useInternalBalance: boolean;
      };
    }

    const encodeSwapParams = (p: Partial<BatchSwapWithFee>) => {
      return [
        p.kind ?? GIVEN_IN,
        p.swaps ?? [],
        p.tokens ?? [],
        p.funds ?? {
          sender: ethers.constants.AddressZero,
          fromInternalBalance: true,
          recipient: ethers.constants.AddressZero,
          toInternalBalance: true,
        },
        p.limits ?? [],
        p.deadline ?? 0,
        p.feeTransfer ?? {
          account: ethers.constants.AddressZero,
          token: ethers.constants.AddressZero,
          amount: ethers.constants.Zero,
          useInternalBalance: false,
        },
      ];
    };
    const emptySwap = encodeSwapParams({});

    it("should revert if not called by the creator", async () => {
      await expect(
        vaultRelayer.connect(nonCreator).batchSwapWithFee(...emptySwap),
      ).to.be.revertedWith("not creator");
    });

    for (const [name, kind] of Object.entries({
      In: GIVEN_IN,
      Out: GIVEN_OUT,
    } as const)) {
      describe(`Swap Given ${name}`, () => {
        it(`performs swaps given ${name.toLowerCase()}`, async () => {
          const swaps = [
            {
              poolId: `0x${"01".repeat(32)}`,
              tokenInIndex: 0,
              tokenOutIndex: 1,
              amount: ethers.utils.parseEther("42.0"),
              userData: "0x010203",
            },
            {
              poolId: `0x${"02".repeat(32)}`,
              tokenInIndex: 1,
              tokenOutIndex: 2,
              amount: ethers.utils.parseEther("1337.0"),
              userData: "0xabcd",
            },
          ];
          const tokens = [
            await waffle.deployMockContract(deployer, IERC20.abi),
            await waffle.deployMockContract(deployer, IERC20.abi),
            await waffle.deployMockContract(deployer, IERC20.abi),
          ];
          const funds = {
            sender: traders[0].address,
            fromInternalBalance: false,
            recipient: traders[1].address,
            toInternalBalance: true,
          };
          const limits = [
            ethers.utils.parseEther("42.0"),
            ethers.constants.Zero,
            ethers.utils.parseEther("1337.0").mul(-1),
          ];
          const deadline = 0x01020304;
          const feeTransfer = {
            account: traders[0].address,
            token: tokens[0].address,
            amount: ethers.utils.parseEther("1.0"),
            useInternalBalance: false,
          };

          await vault.mock[`batchSwapGiven${name}`]
            .withArgs(
              swaps.map(({ amount, ...swap }) => ({
                ...swap,
                [`amount${name}`]: amount,
              })),
              tokens.map(({ address }) => address),
              funds,
              limits,
              deadline,
            )
            .returns([]);
          await tokens[0].mock.transferFrom.returns(true);

          await expect(
            vaultRelayer.batchSwapWithFee(
              kind,
              swaps,
              tokens.map(({ address }) => address),
              funds,
              limits,
              deadline,
              feeTransfer,
            ),
          ).to.not.be.reverted;
        });

        it("returns the Vault swap token deltas", async () => {
          const deltas = [
            ethers.utils.parseEther("42.0"),
            ethers.constants.Zero,
            ethers.utils.parseEther("1337.0").mul(-1),
          ];

          const token = await waffle.deployMockContract(deployer, IERC20.abi);
          const feeTransfer = {
            account: traders[0].address,
            token: token.address,
            amount: ethers.utils.parseEther("1.0"),
            useInternalBalance: false,
          };

          await vault.mock[`batchSwapGiven${name}`].returns(deltas);
          await token.mock.transferFrom.returns(true);

          expect(
            await vaultRelayer.callStatic.batchSwapWithFee(
              ...encodeSwapParams({
                kind,
                feeTransfer,
              }),
            ),
          ).to.deep.equal(deltas);
        });

        it("reverts on failed Vault swap", async () => {
          await vault.mock[`batchSwapGiven${name}`].revertsWithReason(
            "test error",
          );

          await expect(
            vaultRelayer.batchSwapWithFee(...encodeSwapParams({ kind })),
          ).to.be.revertedWith("test error");
        });
      });
    }

    describe("Fee Transfer", () => {
      it("should perform ERC20 transfer when not using internal balance", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwapGivenIn.returns([]);
        await token.mock.transferFrom
          .withArgs(traders[0].address, creator.address, amount)
          .returns(true);

        await expect(
          vaultRelayer.batchSwapWithFee(
            ...encodeSwapParams({
              feeTransfer: {
                account: traders[0].address,
                token: token.address,
                amount,
                useInternalBalance: false,
              },
            }),
          ),
        ).to.not.be.reverted;
      });

      it("should perform Vault internal balance transfer when specified", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwapGivenIn.returns([]);
        await vault.mock.transferInternalBalance
          .withArgs([
            {
              token: token.address,
              amount,
              sender: traders[0].address,
              recipient: creator.address,
            },
          ])
          .returns();

        await expect(
          vaultRelayer.batchSwapWithFee(
            ...encodeSwapParams({
              feeTransfer: {
                account: traders[0].address,
                token: token.address,
                amount,
                useInternalBalance: true,
              },
            }),
          ),
        ).to.not.be.reverted;
      });

      it("should revert on failed ERC20 transfer", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwapGivenIn.returns([]);
        await token.mock.transferFrom
          .withArgs(traders[0].address, creator.address, amount)
          .revertsWithReason("test error");

        await expect(
          vaultRelayer.batchSwapWithFee(
            ...encodeSwapParams({
              feeTransfer: {
                account: traders[0].address,
                token: token.address,
                amount,
                useInternalBalance: false,
              },
            }),
          ),
        ).to.be.revertedWith("test error");
      });

      it("should revert on failed Vault transfer", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwapGivenIn.returns([]);
        await vault.mock.transferInternalBalance
          .withArgs([
            {
              token: token.address,
              amount,
              sender: traders[0].address,
              recipient: creator.address,
            },
          ])
          .revertsWithReason("test error");

        await expect(
          vaultRelayer.batchSwapWithFee(
            ...encodeSwapParams({
              feeTransfer: {
                account: traders[0].address,
                token: token.address,
                amount,
                useInternalBalance: true,
              },
            }),
          ),
        ).to.be.revertedWith("test error");
      });
    });
  });
});
