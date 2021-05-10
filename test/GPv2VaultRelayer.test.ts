import IERC20 from "@openzeppelin/contracts/build/contracts/IERC20.json";
import { expect } from "chai";
import { MockContract } from "ethereum-waffle";
import { BigNumberish, Contract } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";

import { BatchSwapStep } from "../src/ts";

import { SwapKind, UserBalanceOpKind } from "./balancer";
import { OrderBalanceId } from "./encoding";

describe("GPv2VaultRelayer", () => {
  const [deployer, creator, nonCreator, ...traders] =
    waffle.provider.getWallets();

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
        await waffle.deployMockContract(deployer, IERC20.abi),
      ];

      const amount = ethers.utils.parseEther("13.37");
      await tokens[0].mock.transferFrom
        .withArgs(traders[0].address, creator.address, amount)
        .returns(true);
      await vault.mock.manageUserBalance
        .withArgs([
          {
            kind: UserBalanceOpKind.TRANSFER_EXTERNAL,
            asset: tokens[1].address,
            amount,
            sender: traders[1].address,
            recipient: creator.address,
          },
          {
            kind: UserBalanceOpKind.WITHDRAW_INTERNAL,
            asset: tokens[2].address,
            amount,
            sender: traders[2].address,
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
            balance: OrderBalanceId.ERC20,
          },
          {
            account: traders[1].address,
            token: tokens[1].address,
            amount,
            balance: OrderBalanceId.EXTERNAL,
          },
          {
            account: traders[2].address,
            token: tokens[2].address,
            amount,
            balance: OrderBalanceId.INTERNAL,
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
            balance: OrderBalanceId.ERC20,
          },
        ]),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed Vault transfers", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await vault.mock.manageUserBalance
        .withArgs([
          {
            kind: UserBalanceOpKind.TRANSFER_EXTERNAL,
            asset: token.address,
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
            balance: OrderBalanceId.EXTERNAL,
          },
        ]),
      ).to.be.revertedWith("test error");
    });

    it("should revert on failed Vault withdrawals", async () => {
      const token = await waffle.deployMockContract(deployer, IERC20.abi);

      const amount = ethers.utils.parseEther("4.2");
      await vault.mock.manageUserBalance
        .withArgs([
          {
            kind: UserBalanceOpKind.WITHDRAW_INTERNAL,
            asset: token.address,
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
            balance: OrderBalanceId.INTERNAL,
          },
        ]),
      ).to.be.revertedWith("test error");
    });
  });

  describe("batchSwapWithFee", () => {
    interface BatchSwapWithFee {
      kind: SwapKind;
      swaps: BatchSwapStep[];
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
        balance: string;
      };
    }

    const encodeSwapParams = (p: Partial<BatchSwapWithFee>) => {
      return [
        p.kind ?? SwapKind.GIVEN_IN,
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
          balance: OrderBalanceId.ERC20,
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
      In: SwapKind.GIVEN_IN,
      Out: SwapKind.GIVEN_OUT,
    } as const)) {
      describe(`Swap Given ${name}`, () => {
        it(`performs swaps given ${name.toLowerCase()}`, async () => {
          const swaps = [
            {
              poolId: `0x${"01".repeat(32)}`,
              assetInIndex: 0,
              assetOutIndex: 1,
              amount: ethers.utils.parseEther("42.0"),
              userData: "0x010203",
            },
            {
              poolId: `0x${"02".repeat(32)}`,
              assetInIndex: 1,
              assetOutIndex: 2,
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
            balance: OrderBalanceId.ERC20,
          };

          await vault.mock.batchSwap
            .withArgs(
              kind,
              swaps,
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
      });
    }

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
        balance: OrderBalanceId.ERC20,
      };

      await vault.mock.batchSwap.returns(deltas);
      await token.mock.transferFrom.returns(true);

      expect(
        await vaultRelayer.callStatic.batchSwapWithFee(
          ...encodeSwapParams({
            kind: SwapKind.GIVEN_IN,
            feeTransfer,
          }),
        ),
      ).to.deep.equal(deltas);
    });

    it("reverts on failed Vault swap", async () => {
      await vault.mock.batchSwap.revertsWithReason("test error");

      await expect(
        vaultRelayer.batchSwapWithFee(
          ...encodeSwapParams({ kind: SwapKind.GIVEN_OUT }),
        ),
      ).to.be.revertedWith("test error");
    });

    describe("Fee Transfer", () => {
      it("should perform ERC20 transfer when not using direct ERC20 balance", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
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
                balance: OrderBalanceId.ERC20,
              },
            }),
          ),
        ).to.not.be.reverted;
      });

      it("should perform Vault external balance transfer when specified", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
        await vault.mock.manageUserBalance
          .withArgs([
            {
              kind: UserBalanceOpKind.TRANSFER_EXTERNAL,
              asset: token.address,
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
                balance: OrderBalanceId.EXTERNAL,
              },
            }),
          ),
        ).to.not.be.reverted;
      });

      it("should perform Vault internal balance transfer when specified", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
        await vault.mock.manageUserBalance
          .withArgs([
            {
              kind: UserBalanceOpKind.TRANSFER_INTERNAL,
              asset: token.address,
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
                balance: OrderBalanceId.INTERNAL,
              },
            }),
          ),
        ).to.not.be.reverted;
      });

      it("should revert on failed ERC20 transfer", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
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
                balance: OrderBalanceId.ERC20,
              },
            }),
          ),
        ).to.be.revertedWith("test error");
      });

      it("should revert on failed Vault external transfer", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
        await vault.mock.manageUserBalance
          .withArgs([
            {
              kind: UserBalanceOpKind.TRANSFER_EXTERNAL,
              asset: token.address,
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
                balance: OrderBalanceId.EXTERNAL,
              },
            }),
          ),
        ).to.be.revertedWith("test error");
      });

      it("should revert on failed Vault internal transfer", async () => {
        const token = await waffle.deployMockContract(deployer, IERC20.abi);
        const amount = ethers.utils.parseEther("4.2");

        await vault.mock.batchSwap.returns([]);
        await vault.mock.manageUserBalance
          .withArgs([
            {
              kind: UserBalanceOpKind.TRANSFER_INTERNAL,
              asset: token.address,
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
                balance: OrderBalanceId.INTERNAL,
              },
            }),
          ),
        ).to.be.revertedWith("test error");
      });
    });
  });
});
