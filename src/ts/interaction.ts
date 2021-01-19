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
  value?: BigNumberish;
  /**
   * Call data used in the interaction with a smart contract.
   */
  callData?: BytesLike;
}

export function encodeInteraction(interaction: Interaction): string {
  const value = BigNumber.from(interaction.value || 0);
  const callData = interaction.callData || "0x";
  const callDataLength = ethers.utils.hexDataLength(callData);

  const encodedInteraction = value.isZero()
    ? ethers.utils.solidityPack(
        ["address", "bool", "uint24", "bytes"],
        [interaction.target, false, callDataLength, callData],
      )
    : ethers.utils.solidityPack(
        ["address", "bool", "uint24", "uint256", "bytes"],
        [interaction.target, true, callDataLength, value, callData],
      );
  return encodedInteraction;
}

export function packInteractions(interactions: Interaction[]): string {
  return ethers.utils.hexConcat(interactions.map(encodeInteraction));
}
