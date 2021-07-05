import { Interaction } from "../../ts";

import { InteractionDecoder } from "./interaction/template";

// For reference, here is a list of contracts supported by the backend:
// https://github.com/gnosis/gp-v2-services/blob/a472d0dca02c0df30c22e17c959d37e2c828fed2/contracts/build.rs

// Decoded calldata of a function call.
export interface DecodedInteractionCall {
  functionName: string;
  // args is null in case of a decoding error.
  args: Map<string, string> | null;
}

export interface DecodedInteraction {
  targetName: string;
  // call is null in case the decoder does not support the function used in the
  // interaction
  call: DecodedInteractionCall | null;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DecodingTools {
  // Used to pass in objects needed for decoding
}

export async function decode(
  interaction: Interaction,
  decodingTools: DecodingTools = {},
): Promise<DecodedInteraction | null> {
  const decoders: InteractionDecoder[] = [
    /* new decoders should be added here */
  ];

  try {
    // TODO: use Promise.any when better supported by our tooling
    const decoded = (
      await Promise.allSettled(
        decoders.map((decoder) => decoder.decode(interaction, decodingTools)),
      )
    ).filter(
      (result) => result.status === "fulfilled" && result.value !== null,
    ) as PromiseFulfilledResult<DecodedInteraction>[];

    return decoded[0]?.value ?? null;
  } catch {
    // no valid decoding found
    return null;
  }
}
