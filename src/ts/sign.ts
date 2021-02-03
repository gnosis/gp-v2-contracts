import { BytesLike, ethers, Signer } from "ethers";

import { ORDER_TYPE_FIELDS, Order, hashOrder, normalizeOrder } from "./order";
import {
  SignatureLike,
  isTypedDataSigner,
  TypedDataDomain,
} from "./types/ethers";

/**
 * Value returned by a call to `isValidSignature` if the signature was verified
 * successfully. The value is defined in the EIP-1271 standard as:
 * bytes4(keccak256("isValidSignature(bytes32,bytes)"))
 */
export const EIP1271_MAGICVALUE = ethers.utils.hexDataSlice(
  ethers.utils.id("isValidSignature(bytes32,bytes)"),
  0,
  4,
);

/**
 * The signing scheme used to sign the order.
 */
export const enum SigningScheme {
  /**
   * The EIP-712 typed data signing scheme. This is the preferred scheme as it
   * provides more infomation to wallets performing the signature on the data
   * being signed.
   *
   * <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#definition-of-domainseparator>
   */
  EIP712,
  /**
   * Message signed using eth_sign RPC call.
   */
  ETHSIGN,
  /**
   * Smart contract signatures as defined in EIP-1271.
   *
   * <https://eips.ethereum.org/EIPS/eip-1271>
   */
  EIP1271,
}

export type EcdsaSigningScheme = SigningScheme.EIP712 | SigningScheme.ETHSIGN;

/**
 * The signature of an order.
 */
export type Signature = EcdsaSignature | Eip1271Signature;

/**
 * ECDSA signature of an order.
 */
export interface EcdsaSignature {
  /**
   * The signing scheme used in the signature.
   */
  scheme: EcdsaSigningScheme;
  /**
   * The ECDSA signature.
   */
  data: SignatureLike;
}

/**
 * EIP-1271 signature data.
 */
export interface Eip1271SignatureData {
  /**
   * The verifying contract address.
   */
  verifier: string;
  /**
   * The arbitrary signature data used for verification.
   */
  signature: BytesLike;
}

/**
 * EIP-1271 signature of an order.
 */
export interface Eip1271Signature {
  /**
   * The signing scheme used in the signature.
   */
  scheme: SigningScheme.EIP1271;
  /**
   * The signature data.
   */
  data: Eip1271SignatureData;
}

function ecdsaSignOrder(
  domain: TypedDataDomain,
  order: Order,
  owner: Signer,
  scheme: EcdsaSigningScheme,
): Promise<string> {
  switch (scheme) {
    case SigningScheme.EIP712:
      if (!isTypedDataSigner(owner)) {
        throw new Error("signer does not support signing typed data");
      }
      return owner._signTypedData(
        domain,
        { Order: ORDER_TYPE_FIELDS },
        normalizeOrder(order),
      );

    case SigningScheme.ETHSIGN:
      return owner.signMessage(
        ethers.utils.arrayify(
          ethers.utils.hexConcat([
            ethers.utils._TypedDataEncoder.hashDomain(domain),
            hashOrder(order),
          ]),
        ),
      );

    default:
      throw new Error("invalid signing scheme");
  }
}

/**
 * Returns the signature for the specified order with the signing scheme encoded
 * into the signature bytes.
 * @param domain The domain to sign the order for. This is used by the smart
 * contract to ensure orders can't be replayed across different applications,
 * but also different deployments (as the contract chain ID and address are
 * mixed into to the domain value).
 * @param order The order to sign.
 * @param owner The owner for the order used to sign.
 * @param scheme The signing scheme to use. See {@link SigningScheme} for more
 * details.
 * @return Encoded signature including signing scheme for the order.
 */
export async function signOrder(
  domain: TypedDataDomain,
  order: Order,
  owner: Signer,
  scheme: EcdsaSigningScheme,
): Promise<EcdsaSignature> {
  return {
    scheme,
    data: await ecdsaSignOrder(domain, order, owner, scheme),
  };
}

/**
 * Returns the message that a contract should sign to authorize the input order
 * in GPv2.
 *
 * @param domain The domain to sign the order for. This is used by the smart
 * contract to ensure orders can't be replayed across different applications,
 * but also different deployments (as the contract chain ID and address are
 * mixed into to the domain value).
 * @param order The order to sign.
 * @returns The message that needs to be EIP-1271 signed to authorize the input
 * order.
 */
export function eip1271Message(domain: TypedDataDomain, order: Order): string {
  return ethers.utils.keccak256(
    ethers.utils.hexConcat([
      "0x192a",
      ethers.utils._TypedDataEncoder.hashDomain(domain),
      hashOrder(order),
    ]),
  );
}

export function encodeEip1271SignatureData({
  verifier,
  signature,
}: Eip1271SignatureData): string {
  return ethers.utils.solidityPack(["address", "bytes"], [verifier, signature]);
}
