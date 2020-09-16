import {use, expect} from 'chai';
import {Contract, utils} from 'ethers';
import {deployContract, MockProvider, solidity} from 'ethereum-waffle';
import PreAMMBatcher from '../build/PreAMMBatcher.json';
import UniswapV2Pair from '../node_modules/@uniswap/v2-core/build/UniswapV2Pair.json';
import UniswapV2Factory from '../node_modules/@uniswap/v2-core/build/UniswapV2Factory.json';

import ERC20 from '../build/ERC20Mintable.json';
import {Order} from '../src/js/orders.spec';
import BN from 'bn.js';

use(solidity);

async function asyncForEach(array: Order[], callback: any) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const setupOrder = async (orders: Order[], batcher: Contract) => {
  await asyncForEach(orders, async (order: Order) => {
    await order.sellToken.mint(order.wallet.address, order.sellAmount);
    await order.sellToken.connect(order.wallet).approve(batcher.address, order.sellAmount);
  });
};

describe('PreAMMBatcher-e2e', () => {
  const [walletDeployer, walletTrader1, walletTrader2] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;

  beforeEach(async () => {
    token0 = await deployContract(walletDeployer, ERC20, ['token0', '18']);
    token1 = await deployContract(walletDeployer, ERC20, ['token1', '18']);
    uniswapFactory = await deployContract(walletDeployer, UniswapV2Factory, [walletDeployer.address]);
    await uniswapFactory.createPair(token0.address, token1.address, {gasLimit: 6000000});
    uniswapPairAddress = await uniswapFactory.getPair(token0.address, token1.address);
    uniswapPair = await deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await deployContract(walletDeployer, PreAMMBatcher, [uniswapFactory.address]);

    await token0.mint(walletDeployer.address, utils.parseEther('10'));
    await token1.mint(walletDeployer.address, utils.parseEther('10'));
    await token0.transfer(uniswapPair.address, utils.parseEther('10'));
    await token1.transfer(uniswapPair.address, utils.parseEther('10'));
    await uniswapPair.mint(walletDeployer.address, {gasLimit: 500000});
    expect((await uniswapPair.getReserves())[0]).to.equal(utils.parseEther('10'));
  });

  it('pre-batches two simple orders and settles left-overs to uniswap', async () => {
    const sellToken0Order = new Order(utils.parseEther('1'),
      utils.parseEther('0.9'), token0, token1, walletTrader1, 1);
    const sellToken1Order = new Order(utils.parseEther('0.9'),
      utils.parseEther('0.90111'), token1, token0, walletTrader2, 1);

    await setupOrder([sellToken0Order, sellToken1Order], batcher);

    await expect(batcher.batchTrade(sellToken0Order.encode(), sellToken1Order.encode(), {gasLimit: 6000000}))
      .to.emit(batcher, 'BatchSettlement')
      .withArgs(token0.address, token1.address, '9916608715780969175', '10084092542732199005');

    expect((await uniswapPair.getReserves())[0]).to.equal('10084799698306515679');
    expect((await uniswapPair.getReserves())[1]).to.equal('9916858889633626266');
    console.log('auction clearing price:',
      (new BN('10084092542732199005').mul(new BN('1000')).div(new BN('9916608715780969175'))).toString());
    console.log('uniswap clearing price:',
      ((await uniswapPair.getReserves())[0]).mul(1000).div((await uniswapPair.getReserves())[1]).toString());
  });
});
