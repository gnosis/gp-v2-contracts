import { expect } from "chai";

import {
  encodeTradeFlags,
  decodeTradeFlags,
  FLAG_MASKS,
  TradeFlags,
  FlagKey,
} from "../src/ts";

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
  return cartesian(
    ...Object.values(allEncodedFlagOptions()),
  ).map((flagOptions) =>
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
    result[key as FlagKey] = (options as readonly unknown[]).map(
      (_, index) => index << offset,
    );
  });
  return result as Out;
}

function validFlags(): TradeFlags[] {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const keyedOptions = Object.entries(FLAG_MASKS).map(([key, { options }]) =>
    options.map((option: unknown) => [key, option]),
  );
  const combinations = cartesian(...keyedOptions);
  return combinations.map((transposedKeyedOptions) => {
    const tradeFlags: any = {};
    transposedKeyedOptions.forEach(
      ([key, option]: any) => (tradeFlags[key] = option),
    );
    return (tradeFlags as unknown) as TradeFlags;
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe("Flag decoding", () => {
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
