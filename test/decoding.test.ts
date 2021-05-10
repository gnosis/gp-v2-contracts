import { expect } from "chai";
import { constants, utils, Wallet } from "ethers";
import { waffle } from "hardhat";

import {
  EcdsaSigningScheme,
  FLAG_MASKS,
  FlagKey,
  OrderBalance,
  OrderKind,
  SettlementEncoder,
  SigningScheme,
  TradeFlags,
  decodeOrder,
  decodeSignatureOwner,
  decodeTradeFlags,
  domain,
  encodeEip1271SignatureData,
  encodeTradeFlags,
  signOrder,
} from "../src/ts";

import { fillDistinctBytes, SAMPLE_ORDER } from "./testHelpers";

type UnknownArray = unknown[] | readonly unknown[];
// [A, B, C] -> [A, B]
type RemoveLast<T extends UnknownArray> = T extends [...infer U, unknown]
  ? U
  : [];
// [A, B, C] -> C
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type GetLast<T extends UnknownArray> = T extends [...infer _, infer U]
  ? U
  : never;
// A[] -> A
type ArrayType<T> = T extends (infer U)[]
  ? U
  : T extends readonly (infer U)[]
  ? U
  : [];
type UnknownMatrix = UnknownArray[] | readonly UnknownArray[];
// [A[], B[], C[]] -> [A, B, C]
type ArrayTupleType<T extends UnknownMatrix> = T extends []
  ? []
  : [...ArrayTupleType<RemoveLast<T>>, ArrayType<GetLast<T>>];
// [A[], B[], C[]] -> [A, B, C][]
type Transpose<T extends UnknownMatrix> = ArrayTupleType<T>[];

// Computes the Cartesian product between all input arrays.
function cartesian<T extends UnknownMatrix>(...arrays: T): Transpose<T> {
  if (arrays.length === 0) {
    return [];
  }

  let partialProd: UnknownMatrix = [[]];
  arrays.map((array: readonly unknown[]) => {
    partialProd = partialProd
      .map((tuple: UnknownArray) =>
        array.map((elt: unknown) => [...tuple, elt]),
      )
      .flat();
  });

  return partialProd as Transpose<T>;
}

function validEncodedFlags(): number[] {
  return cartesian(...Object.values(allEncodedFlagOptions())).map(
    (flagOptions) =>
      flagOptions.reduce(
        (cumulative: number, flagOption: number) => cumulative | flagOption,
        0,
      ),
  );
}

// Returns an object that assigns to every key all encoded flags for that key.
function allEncodedFlagOptions<Out extends Record<FlagKey, number[]>>(): Out {
  const result: Partial<Out> = {};
  Object.entries(FLAG_MASKS).map(([key, { offset, options }]) => {
    result[key as FlagKey] = (options as readonly unknown[])
      .map((option, index) => ({
        option,
        value: index << offset,
      }))
      .filter(({ option }) => option !== undefined)
      .map(({ value }) => value);
  });
  return result as Out;
}

function validFlags(): TradeFlags[] {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const keyedOptions = Object.entries(FLAG_MASKS).map(([key, { options }]) =>
    options
      .map((option: unknown) => [key, option])
      .filter(([, option]) => option !== undefined),
  );
  const combinations = cartesian(...keyedOptions);
  return combinations.map((transposedKeyedOptions) => {
    const tradeFlags: any = {};
    transposedKeyedOptions.forEach(
      ([key, option]: any) => (tradeFlags[key] = option),
    );
    return tradeFlags as unknown as TradeFlags;
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe("Order flags", () => {
  it("encodeTradeFlags is the right inverse of decodeTradeFlags", () => {
    for (const tradeFlags of validFlags()) {
      expect(decodeTradeFlags(encodeTradeFlags(tradeFlags))).to.deep.equal(
        tradeFlags,
      );
    }
  });

  it("encodeTradeFlags is the left inverse of decodeTradeFlags", () => {
    for (const encodedTradeFlags of validEncodedFlags()) {
      expect(encodeTradeFlags(decodeTradeFlags(encodedTradeFlags))).to.equal(
        encodedTradeFlags,
      );
    }
  });
});

describe("Signer", () => {
  const domainSeparator = domain(1337, constants.AddressZero);

  let ecdsaSigner: Wallet;

  beforeEach(async () => {
    [ecdsaSigner] = await waffle.provider.getWallets();
  });

  const ecdsaSchemes: EcdsaSigningScheme[] = [
    SigningScheme.EIP712,
    SigningScheme.ETHSIGN,
  ];
  for (const scheme of ecdsaSchemes) {
    it(`ecdsa ${scheme}`, async () => {
      const signature = await utils.joinSignature(
        (
          await signOrder(domainSeparator, SAMPLE_ORDER, ecdsaSigner, scheme)
        ).data,
      );
      expect(
        decodeSignatureOwner(domainSeparator, SAMPLE_ORDER, scheme, signature),
      ).to.deep.equal(ecdsaSigner.address);
    });
  }

  it("eip-1271", () => {
    const verifier = utils.getAddress(fillDistinctBytes(20, 1));
    const signature = encodeEip1271SignatureData({
      signature: "0x1337",
      verifier,
    });
    expect(
      decodeSignatureOwner(
        domainSeparator,
        SAMPLE_ORDER,
        SigningScheme.EIP1271,
        signature,
      ),
    ).to.equal(verifier);
  });

  it("presign", () => {
    const signer = utils.getAddress(fillDistinctBytes(20, 1));
    expect(
      decodeSignatureOwner(
        domainSeparator,
        SAMPLE_ORDER,
        SigningScheme.PRESIGN,
        signer,
      ),
    ).to.equal(signer);
  });
});

describe("Trade", async () => {
  it("sample order", async () => {
    const domainSeparator = domain(1337, constants.AddressZero);
    const [ecdsaSigner] = await waffle.provider.getWallets();
    const encoder = new SettlementEncoder(domainSeparator);
    const order = {
      ...SAMPLE_ORDER,
      partiallyFillable: true,
      kind: OrderKind.BUY,
      sellTokenBalance: OrderBalance.EXTERNAL,
      buyTokenBalance: OrderBalance.INTERNAL,
    };
    encoder.encodeTrade(
      order,
      await signOrder(
        domainSeparator,
        order,
        ecdsaSigner,
        SigningScheme.ETHSIGN,
      ),
      { executedAmount: 42 },
    );
    expect(decodeOrder(encoder.trades[0], encoder.tokens)).to.deep.equal(order);
  });
});
