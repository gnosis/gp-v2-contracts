import {use, expect} from 'chai';
import {Contract, utils} from 'ethers';
import {deployContract, deployMockContract, MockProvider, solidity} from 'ethereum-waffle';
import PreAMMBatcher from '../build/PreAMMBatcher.json';
import UniswapV2Pair from '../node_modules/@uniswap/v2-core/build/UniswapV2Pair.json';
import UniswapV2Factory from '../node_modules/@uniswap/v2-core/build/UniswapV2Factory.json';

import ERC20 from '../node_modules/@openzeppelin/contracts/build/contracts/ERC20Mintable.json';
import {Order, DOMAIN_SEPARATOR} from '../src/js/orders.spec';
import BN from 'bn.js';

use(solidity);


describe('PreAMMBatcher', () => {
  const [walletDeployer, walletTrader1, walletTrader2] = new MockProvider().getWallets();
  let batcher: Contract;
  let token0: Contract;
  let token1: Contract;
  let uniswapPair: Contract;
  let uniswapFactory: Contract;
  let uniswapPairAddress: string;
  let initial_uniswap_funding_token0 =utils.parseEther('10')
  let initial_uniswap_funding_token1 =utils.parseEther('10')

  const mockRelevantTokenDataForPreBatchTrade = async ( sellOrder1: Order, sellOrder2:Order) =>{
    // todo: mock actual right information
    // mock un-relevant data to make preBatchTrade call pass
    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(true);
    await token0.mock.transfer.returns(true);
    await token1.mock.transfer.returns(true);
    await token0.mock.balanceOf.withArgs(sellOrder1.wallet.address).returns(sellOrder1.sellAmount);
    await token1.mock.balanceOf.withArgs(sellOrder2.wallet.address).returns(sellOrder2.sellAmount);
    await token0.mock.balanceOf.withArgs(batcher.address).returns('1');
    await token1.mock.balanceOf.withArgs(batcher.address).returns('1');
    await token0.mock.balanceOf.withArgs(uniswapPair.address).returns(new BN(initial_uniswap_funding_token0.toString()).add(sellOrder1.sellAmount).toString());
    await token1.mock.balanceOf.withArgs(uniswapPair.address).returns(initial_uniswap_funding_token1);
}

  beforeEach(async () => {
    token0 = await deployMockContract(walletDeployer, ERC20.abi);
    token1 = await deployMockContract(walletDeployer, ERC20.abi);
    uniswapFactory = await deployContract(walletDeployer, UniswapV2Factory, [walletDeployer.address]);
    await uniswapFactory.createPair(token0.address, token1.address, {gasLimit: 6000000});
    uniswapPairAddress = await uniswapFactory.getPair(token0.address, token1.address);
    uniswapPair = await deployContract(walletDeployer, UniswapV2Pair);
    uniswapPair = await uniswapPair.attach(uniswapPairAddress);
    batcher = await deployContract(walletDeployer, PreAMMBatcher, [uniswapFactory.address]);

    await token0.mock.balanceOf.withArgs(uniswapPair.address).returns(initial_uniswap_funding_token0)
    await token1.mock.balanceOf.withArgs(uniswapPair.address).returns(initial_uniswap_funding_token1)

    await uniswapPair.mint(walletDeployer.address, {gasLimit: 500000});
    expect((await uniswapPair.getReserves())[0]).to.equal(initial_uniswap_funding_token0);
  });


  it('DOMAIN_SEPARATOR is correct', async()=>{
    expect(await batcher.DOMAIN_SEPARATOR()).to.equal(DOMAIN_SEPARATOR)
  })

  it('receiveTradeAmounts reverts if transferFrom fails for token0', async()=>{
    const sellToken0Order = new Order(new BN(utils.parseEther('1').toString()),
    new BN(utils.parseEther('0.9').toString()), token0.address, token1.address, walletTrader1, new BN('1'));
  const sellToken1Order = new Order(new BN(utils.parseEther('0.9').toString()),
    new BN(utils.parseEther('0.90111').toString()), token1.address, token0.address, walletTrader2, new BN('1'));

    await token0.mock.transferFrom.returns(false);
    await expect(batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode(), {gasLimit: 6000000})).to.be.revertedWith('transferFrom for token0 was not successful');
  })
  it('receiveTradeAmounts transferFrom the right amount of token0', async()=>{
    const sellToken0Order = new Order(new BN(utils.parseEther('1').toString()),
    new BN(utils.parseEther('0.9').toString()), token0.address, token1.address, walletTrader1, new BN('1'));
  const sellToken1Order = new Order(new BN(utils.parseEther('0.9').toString()),
    new BN(utils.parseEther('0.90111').toString()), token1.address, token0.address, walletTrader2, new BN('1'));

    await mockRelevantTokenDataForPreBatchTrade( sellToken0Order, sellToken1Order );
    await batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode())
    expect('transferFrom').to.be.calledOnContractWith(token0, [walletTrader1.address, batcher.address, sellToken0Order.sellAmount.toString()]);
  })
  it('receiveTradeAmounts reverts if transferFrom fails for token1', async()=>{
    const sellToken0Order = new Order(new BN(utils.parseEther('1').toString()),
    new BN(utils.parseEther('0.9').toString()), token0.address, token1.address, walletTrader1, new BN('1'));
  const sellToken1Order = new Order(new BN(utils.parseEther('0.9').toString()),
    new BN(utils.parseEther('0.90111').toString()), token1.address, token0.address, walletTrader2, new BN('1'));

    await token0.mock.transferFrom.returns(true);
    await token1.mock.transferFrom.returns(false);
    await expect(batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode(), {gasLimit: 6000000})).to.be.revertedWith('transferFrom for token1 was not successful');
  })
  it('receiveTradeAmounts transferFrom the right amount of token1', async()=>{
    const sellToken0Order = new Order(new BN(utils.parseEther('1').toString()),
    new BN(utils.parseEther('0.9').toString()), token0.address, token1.address, walletTrader1, new BN('1'));
  const sellToken1Order = new Order(new BN(utils.parseEther('0.9').toString()),
    new BN(utils.parseEther('0.90111').toString()), token1.address, token0.address, walletTrader2, new BN('1'));

    await mockRelevantTokenDataForPreBatchTrade( sellToken0Order, sellToken1Order );
    await batcher.preBatchTrade(sellToken0Order.encode(), sellToken1Order.encode())
   expect('transferFrom').to.be.calledOnContractWith(token1, [walletTrader2.address, batcher.address, sellToken1Order.sellAmount.toString()]);
  })
})