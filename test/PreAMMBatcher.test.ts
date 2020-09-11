import {expect, use} from 'chai';
import {Contract} from 'ethers';
import {deployContract, MockProvider, solidity} from 'ethereum-waffle';
import PreAMMBatcher from '../build/PreAMMBatcher.json';

use(solidity);

describe('BasicToken', () => {
  const [wallet] = new MockProvider().getWallets();
  let batcher: Contract;

  beforeEach(async () => {
    batcher = await deployContract(wallet, PreAMMBatcher);
  });

  it('Assigns initial balance', async () => {
    expect(await batcher.x_uniswap()).to.equal(10000);
  });
});
