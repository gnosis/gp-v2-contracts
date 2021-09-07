interface PendingToken {
  /**
   * The address of the token.
   */
  address: string;
  /**
   * How many consecutive times the script sold this token with no success.
   * Note that the script will not wait to check if the orders were successful,
   * which means that every order in a run will add a pending token with one
   * retry.
   *
   * @minimum 1
   * @TJS-type integer
   */
  retries: number;
}

export default interface State {
  /**
   * Latest block number when the balances were withdrawn in the previous run.
   *
   * @minimum 0
   * @TJS-type integer
   */
  lastUpdateBlock: number;
  /**
   * All tokens ever traded on GPv2. Stored in the state to avoid stressing the
   * node by recovering the list every time.
   */
  tradedTokens: string[];
  /**
   * Index (in tradedTokens) following that of the last withdrawn token in the
   * previous run of this script.
   *
   * @minimum 0
   * @TJS-type integer
   */
  nextTokenToTrade: number;
  /**
   * Tokens that have a pending order from a previous execution of the withdraw
   * service.
   */
  pendingTokens: PendingToken[];
}
