
import BN from 'bn.js';
import abi from 'ethereumjs-abi';
import {utils, Wallet} from 'ethers';
import {ecsign} from 'ethereumjs-util';

export const DOMAIN_SEPARATOR = '0x24a654ed47680d6a76f087ec92b3a0f0fe4c9c82c26bff3bb22dffe0f120c7f0';

export class Order {
  sellAmount: BN;
  buyAmount: BN;
  sellToken: string;
  buyToken: string;
  wallet: Wallet;
  nonce: BN;

  constructor(sellAmount: BN | number, buyAmount: BN | number, sellToken: string,
    buyToken: string, wallet: Wallet, nonce: BN | number) {
    this.sellAmount = new BN(sellAmount);
    this.buyAmount = new BN(buyAmount);
    this.sellToken = sellToken;
    this.buyToken = buyToken;
    this.wallet = wallet;
    this.nonce = new BN(nonce);
  }

  encode(): Buffer {
    const digest = this.getOrderDigest();
    const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(this.wallet.privateKey.slice(2), 'hex'));
    return abi.rawEncode(['uint256', 'uint256', 'address', 'address',
      'address', 'uint8', 'uint8', 'bytes32', 'bytes32'],
    [this.sellAmount.toString(), this.buyAmount.toString(), this.sellToken, this.buyToken,
      this.wallet.address, this.nonce.toString(), v, utils.hexlify(r), utils.hexlify(s)]);
  }

  getOrderDigest(): string {
    return utils.keccak256(
      utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256', 'address', 'address', 'address', 'uint8'],
        [DOMAIN_SEPARATOR, this.sellAmount.toString(), this.buyAmount.toString(), this.sellToken,
          this.buyToken, this.wallet.address, this.nonce.toString()]
      ));
  }
}
