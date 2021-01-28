import { BigNumber, BigNumberish, BytesLike, ethers } from "ethers";

/**
 * Gnosis Protocol v2 interaction data.
 */
export interface Interaction {
  /**
   * Address of the smart contract to be called in this interaction.
   */
  target: string;
  /**
   * Call value in wei for the interaction, allowing Ether to be sent.
   */
  value: BigNumberish;
  /**
   * Call data used in the interaction with a smart contract.
   */
  callData: BytesLike;
}

export type InteractionLike = Pick<Interaction, "target"> &
  Partial<Interaction>;

/**
 * Normalizes interaction data so that it is ready to be be ABI encoded.
 *
 * @param interaction The interaction to normalize.
 * @return The normalized interaction.
 */
export function normalizeInteraction(
  interaction: InteractionLike,
): Interaction {
  return {
    value: 0,
    callData: "0x",
    ...interaction,
  };
}

/**
 * Normalizes data for many interactions so that they can be ABI encoded. This
 * calls [`normalizeInteraction`] for each interaction.
 *
 * @param interactions The interactions to normalize.
 * @return The normalized interactions.
 */
export function normalizeInteractions(
  interactions: InteractionLike[],
): Interaction[] {
  return interactions.map(normalizeInteraction);
}

export function encodeInteraction(interaction: InteractionLike): string {
  const { target, value, callData } = normalizeInteraction(interaction);
  const callDataLength = ethers.utils.hexDataLength(callData);

  const encodedInteraction = BigNumber.from(value).isZero()
    ? ethers.utils.solidityPack(
        ["address", "bool", "uint24", "bytes"],
        [target, false, callDataLength, callData],
      )
    : ethers.utils.solidityPack(
        ["address", "bool", "uint24", "uint256", "bytes"],
        [target, true, callDataLength, value, callData],
      );
  return encodedInteraction;
}

export function packInteractions(interactions: InteractionLike[]): string {
  return ethers.utils.hexConcat(interactions.map(encodeInteraction));
}
