import Debug from "debug";
import { ethers } from "ethers";
import { experimentalAddHardhatNetworkMessageTraceHook } from "hardhat/config";
import {
  DecodedCallMessageTrace,
  isDecodedCallTrace,
} from "hardhat/internal/hardhat-network/stack-traces/message-trace";
import { VMTracer } from "hardhat/internal/hardhat-network/stack-traces/vm-tracer";

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

// NOTE: Leverage how hacky you can get with NodeJS and modify the tracer to
// include additional gas information for instructions and subtraces. This code
// should ideally be upstreamed and the experimental tracing extended to include
// additional gas usage data.
/* eslint-disable @typescript-eslint/no-explicit-any */
const VMTracerPrototype = VMTracer.prototype as any;
const { _stepHandler, _afterMessageHandler } = VMTracerPrototype;
VMTracerPrototype._stepHandler = function (step: any, next: any) {
  const trace = this._messageTraces[this._messageTraces.length - 1] || {
    steps: [],
  };
  const nsteps = trace.steps.length;
  return _stepHandler.call(this, step, (...args: unknown[]) => {
    // NOTE: Check if the step handler added a step, and if it did, the add gas
    // information to it.
    if (trace.steps.length != nsteps) {
      trace.steps[nsteps].gasLeft = step.gasLeft;
    }
    next(...args);
  });
};
VMTracerPrototype._afterMessageHandler = function (result: any, next: any) {
  const trace = this._messageTraces[this._messageTraces.length - 1] || {};
  trace.gasLeft = result?.execResult?.gas;
  trace.gasRefund = result?.execResult?.gasRefund;
  return _afterMessageHandler.call(this, result, next);
};
/* eslint-enable */

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
