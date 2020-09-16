import {use, expect} from 'chai';
import {Contract, utils} from 'ethers';
import {deployContract, deployMockContract, MockProvider, solidity} from 'ethereum-waffle';
import PreAMMBatcher from '../build/PreAMMBatcher.json';
import UniswapV2Pair from '../node_modules/@uniswap/v2-core/build/UniswapV2Pair.json';
import UniswapV2Factory from '../node_modules/@uniswap/v2-core/build/UniswapV2Factory.json';

import ERC20 from '../build/ERC20Mintable.json';
import {Order, DOMAIN_SEPARATOR} from '../src/js/orders.spec';
import {baseTestInput} from './resources/index';

use(solidity);

describe('PreAMMBatcher', () => {
  const [walletDeployer, walletTrader1, walletTrader2] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;
  const initialUniswapFundingOfToken0 = utils.parseEther('10');
  const initialUniswapFundingOfToken1 = utils.parseEther('10');

  const mockRelevantTokenDataForBatchTrade = async (sellOrder1: Order, sellOrder2: Order) => {
    // todo: mock actual right information
    // mock un-relevant data to make batchTrade call pass
    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(true);
    await token0.mock.transfer.returns(true);
    await token1.mock.transfer.returns(true);
    await token0.mock.allowance.withArgs(sellOrder1.wallet.address, batcher.address)
      .returns(sellOrder1.sellAmount.toString());
    await token1.mock.allowance.withArgs(sellOrder2.wallet.address, batcher.address)
      .returns(sellOrder2.sellAmount.toString());
    await token0.mock.balanceOf.withArgs(sellOrder1.wallet.address).returns(sellOrder1.sellAmount.toString());
    await token1.mock.balanceOf.withArgs(sellOrder2.wallet.address).returns(sellOrder2.sellAmount.toString());
    await token0.mock.balanceOf.withArgs(batcher.address).returns('1');
    await token1.mock.balanceOf.withArgs(batcher.address).returns('1');
    await token0.mock.balanceOf.withArgs(uniswapPair.address)
      .returns(initialUniswapFundingOfToken0.add(sellOrder1.sellAmount).toString());
    await token1.mock.balanceOf.withArgs(uniswapPair.address).returns(initialUniswapFundingOfToken1);
  };

  beforeEach(async () => {
    // deploy all relevant contracts and setup the uniswap pool
    token0 = await deployMockContract(walletDeployer, ERC20.abi);
    token1 = await deployMockContract(walletDeployer, ERC20.abi);
    uniswapFactory = await deployContract(walletDeployer, UniswapV2Factory, [walletDeployer.address]);
    await uniswapFactory.createPair(token0.address, token1.address, {gasLimit: 6000000});
    uniswapPairAddress = await uniswapFactory.getPair(token0.address, token1.address);
    uniswapPair = await deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await deployContract(walletDeployer, PreAMMBatcher, [uniswapFactory.address]);

    await token0.mock.balanceOf.withArgs(uniswapPair.address).returns(initialUniswapFundingOfToken0);
    await token1.mock.balanceOf.withArgs(uniswapPair.address).returns(initialUniswapFundingOfToken1);

    await uniswapPair.mint(walletDeployer.address, {gasLimit: 500000});
    expect((await uniswapPair.getReserves())[0]).to.equal(initialUniswapFundingOfToken0);
  });

  it('DOMAIN_SEPARATOR is correct', async () => {
    expect(await batcher.DOMAIN_SEPARATOR()).to.equal(DOMAIN_SEPARATOR);
  });

  it('orderChecks runs through smoothly', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);

    await batcher.orderChecks([testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
      [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()], {gasLimit: 6000000});
  });

  it('orderChecks detects non matching orders', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);
    testCaseInput.sellOrdersToken1[0].sellToken = token0;

    await expect(batcher.orderChecks([testCaseInput.sellOrdersToken0[0].getSmartContractOrder()],
      [testCaseInput.sellOrdersToken1[0].getSmartContractOrder()], {gasLimit: 6000000}))
      .to.revertedWith('sellOrderToken1 are not compatible in sellToken'); ;
  });

  it('parseOrderBytes runs through smoothly for 1 order', async () => {
    const sellToken0Order = new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, walletTrader1, 1);

    await batcher.parseOrderBytes(sellToken0Order.encode(), {gasLimit: 6000000});
  });

  it('parseOrderBytes runs through smoothly for 2 orders', async () => {
    const sellToken0Order = new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, walletTrader1, 1);
    const sellToken0Order2 = new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, walletTrader1, 2);

    await batcher.parseOrderBytes(Buffer.concat([sellToken0Order.encode(), sellToken0Order2.encode()]),
      {gasLimit: 6000000});
  });

  it('receiveTradeAmounts reverts if transferFrom fails for token0', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);

    await mockRelevantTokenDataForBatchTrade(testCaseInput.sellOrdersToken0[0], testCaseInput.sellOrdersToken1[0]);
    await token0.mock.transferFrom.returns(false);
    await expect(batcher.batchTrade(testCaseInput.sellOrdersToken0[0].encode(),
      testCaseInput.sellOrdersToken1[0].encode(), {gasLimit: 6000000}))
      .to.be.revertedWith('unsuccessful transferFrom for order');
  });

  it('receiveTradeAmounts transferFrom the right amount of token0', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);

    await mockRelevantTokenDataForBatchTrade(testCaseInput.sellOrdersToken0[0], testCaseInput.sellOrdersToken1[0]);

    await batcher.batchTrade(testCaseInput.sellOrdersToken0[0].encode(),
      testCaseInput.sellOrdersToken1[0].encode(), {gasLimit: 6000000});
    expect('transferFrom').to.be.calledOnContractWith(token0,
      [walletTrader1.address, batcher.address, testCaseInput.sellOrdersToken0[0].sellAmount.toString()]);
  });
  it('receiveTradeAmounts reverts if transferFrom fails for token1', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);

    await mockRelevantTokenDataForBatchTrade(testCaseInput.sellOrdersToken0[0], testCaseInput.sellOrdersToken1[0]);

    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(false);
    await expect(batcher.batchTrade(testCaseInput.sellOrdersToken0[0].encode(),
      testCaseInput.sellOrdersToken1[0].encode(), {gasLimit: 6000000}))
      .to.be.revertedWith('unsuccessful transferFrom for order');
  });
  it('receiveTradeAmounts transferFrom the right amount of token1', async () => {
    const testCaseInput = baseTestInput(token0, token1, [walletTrader1], [walletTrader2]);
    await mockRelevantTokenDataForBatchTrade(testCaseInput.sellOrdersToken0[0], testCaseInput.sellOrdersToken1[0]);
    await batcher.batchTrade(testCaseInput.sellOrdersToken0[0].encode(), testCaseInput.sellOrdersToken1[0].encode(),
      {gasLimit: 6000000});
    expect('transferFrom').to.be.calledOnContractWith(token1,
      [walletTrader2.address, batcher.address, testCaseInput.sellOrdersToken1[0].sellAmount.toString()]);
  });
});
