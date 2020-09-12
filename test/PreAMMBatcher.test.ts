import {use, expect} from 'chai';
import {Contract, utils} from 'ethers';
import {deployContract, MockProvider, solidity} from 'ethereum-waffle';
import {deployMockContract} from '@ethereum-waffle/mock-contract';
import PreAMMBatcher from '../build/PreAMMBatcher.json';
import UniswapV2Pair from '../node_modules/@uniswap/v2-core/build/UniswapV2Pair.json';
import UniswapV2Factory from '../node_modules/@uniswap/v2-core/build/UniswapV2Factory.json';

import ERC20 from '../build/UniswapV2ERC20.json';
import {Order} from '../src/js/orders.spec';
import BN from 'bn.js';

use(solidity);

describe('BasicToken', () => {
  const [walletDeployer, walletTrader1, walletTrader2] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;

  beforeEach(async () => {
    token0 = await deployMockContract(walletDeployer, ERC20.abi);
    token1 = await deployMockContract(walletDeployer, ERC20.abi);
    uniswapFactory = await deployContract(walletDeployer, UniswapV2Factory, [walletDeployer.address], {gasLimit: 6000000});
    await uniswapFactory.createPair(token0.address, token1.address, {gasLimit: 6000000});
    uniswapPairAddress = await uniswapFactory.getPair(token0.address, token1.address);
    uniswapPair = await deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await deployContract(walletDeployer, PreAMMBatcher, [uniswapFactory.address]);

    // mint equal amount for price = 1 to uniswap
    await token0.mock.balanceOf.withArgs(uniswapPairAddress).returns(utils.parseEther('10'));
    await token1.mock.balanceOf.withArgs(uniswapPairAddress).returns(utils.parseEther('10'));
    await uniswapPair.mint(walletDeployer.address, {gasLimit: 500000});
  });

  it('prebatches two simple orders and settles left-overs to uniswap', async () => {
    const sellToken0Order = new Order(new BN(utils.parseEther('1').toString()), new BN(utils.parseEther('0.9').toString()), token0.address, token1.address, walletTrader1.address);
    const sellToken1Order = new Order(new BN(utils.parseEther('0.5').toString()), new BN(utils.parseEther('0.50111').toString()), token1.address, token0.address, walletTrader2.address);
    console.log(sellToken0Order.sellAmount);
    // receiving funds into batch contract
    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(true);
    // transferring tokens into uniswap
    await token0.mock.transfer.returns(true);
    await token1.mock.transfer.returns(true);

    // uniswap should have 'leftover' token0
    await token0.mock.balanceOf.withArgs(uniswapPairAddress).returns(utils.parseEther('0.5'));
    await token1.mock.balanceOf.withArgs(uniswapPairAddress).returns(utils.parseEther('0'));

    // await token0.mock.transferFrom.withArgs(walletTrader1.address, uniswapPair.address, sellToken0Order.sellAmount).returns(true);
    // await token1.mock.transferFrom.withArgs(walletTrader2.address, uniswapPair.address, sellToken1Order.sellAmount).returns(true);
    await expect(batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode(), {gasLimit: 6000000}))
      .to.emit(batcher, 'BatchSettlement')
      .withArgs(token0.address, token1.address, new BN('477272727272727272'), utils.parseEther('0.5').toString());
    await batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode(), {gasLimit: 6000000});

    expect((await uniswapPair.getReserves())[0]).to.equal(120);
  });
});
