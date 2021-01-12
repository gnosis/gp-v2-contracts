import type { BigNumberish, BytesLike } from "ethers";

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
  value?: BigNumberish;
  /**
   * Call data used in the interaction with a smart contract.
   */
  callData?: BytesLike;
}
