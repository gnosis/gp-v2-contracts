import { BytesLike, ethers, Signer } from "ethers";

import { hashOrder, Order, ORDER_TYPE_FIELDS, timestamp } from "./order";
import { isTypedDataSigner, TypedDataDomain } from "./types/ethers";

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
}

/**
 * The signature of an order.
 * It includes the information needed to determine which signing scheme is used.
 */
export interface Signature {
  /**
   * The signing scheme used in the signature.
   */
  scheme: SigningScheme;
  /**
   * The signature bytes as prescribed by the selected signing scheme.
   */
  data: BytesLike;
}

function ecdsaSignOrder(
  domain: TypedDataDomain,
  order: Order,
  owner: Signer,
  scheme: SigningScheme,
): Promise<string> {
  switch (scheme) {
    case SigningScheme.EIP712:
      if (!isTypedDataSigner(owner)) {
        throw new Error("signer does not support signing typed data");
      }
      return owner._signTypedData(
        domain,
        { Order: ORDER_TYPE_FIELDS },
        { ...order, validTo: timestamp(order.validTo) },
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
  scheme: SigningScheme,
): Promise<Signature> {
  if (![SigningScheme.EIP712, SigningScheme.ETHSIGN].includes(scheme)) {
    throw new Error(
      "Cannot create a signature with the specified signing scheme",
    );
  }
  const rawEcdsaSignature = await ecdsaSignOrder(domain, order, owner, scheme);
  const ecdsaSignature = ethers.utils.splitSignature(rawEcdsaSignature);

  const data = ethers.utils.solidityPack(
    ["bytes32", "bytes32", "uint8"],
    [ecdsaSignature.r, ecdsaSignature.s, ecdsaSignature.v],
  );

  return {
    data,
    scheme,
  };
}

/**
 * Throws an error if the signature length is incompatible with the signing
 * scheme. It does not otherwise check the signature for validity.
 *
 * @param sig The signature to check.
 */
export function assertValidSignatureLength(sig: Signature): void {
  const ECDSA_SIGNATURE_LENGTH = 65;
  if (
    [SigningScheme.EIP712, SigningScheme.ETHSIGN].includes(sig.scheme) &&
    ethers.utils.hexDataLength(sig.data) !== ECDSA_SIGNATURE_LENGTH
  ) {
    throw new Error("invalid signature bytes");
  }
}
