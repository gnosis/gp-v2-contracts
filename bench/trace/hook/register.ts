import Debug from "debug";
import { ethers } from "ethers";
import { experimentalAddHardhatNetworkMessageTraceHook } from "hardhat/config";
import {
  DecodedCallMessageTrace,
  isDecodedCallTrace,
} from "hardhat/internal/hardhat-network/stack-traces/message-trace";

const debug = Debug("bench:trace:hook:register");

let lastTrace: DecodedCallMessageTrace | undefined;

// NOTE: Use experimental tracing feature, here be dragons...
experimentalAddHardhatNetworkMessageTraceHook(async ({ ethers }, trace) => {
  if (!isDecodedCallTrace(trace)) {
    return;
  }

  const address = ethers.utils.getAddress(ethers.utils.hexlify(trace.address));
  const selector =
    trace.calldata.length >= 4
      ? ethers.utils.hexlify(trace.calldata.slice(0, 4))
      : "0x00000000";
  debug(
    `tracing ${trace.bytecode.contract.name}@${address} calling ${selector}`,
  );

  lastTrace = trace;
});

export function getLastTrace(
  selector?: string,
): DecodedCallMessageTrace | undefined {
  if (
    selector !== undefined &&
    lastTrace !== undefined &&
    selector !== ethers.utils.hexlify(lastTrace.calldata.slice(0, 4))
  ) {
    return undefined;
  }

  return lastTrace;
}
