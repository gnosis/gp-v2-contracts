import { assert } from "chai";
import Debug from "debug";

const log = Debug("test:console:log");
const warn = Debug("test:console:warn");

let consoleLog: typeof console.log;
let consoleWarn: typeof console.warn;
let consoleSuppressed = false;

export const useDebugConsole: () => void = () => {
  assert(!consoleSuppressed);
  consoleLog = console.log;
  console.log = log;
  consoleWarn = console.warn;
  console.warn = warn;
  consoleSuppressed = true;
};

export const restoreStandardConsole: () => void = () => {
  assert(consoleSuppressed);
  console.log = consoleLog;
  console.warn = consoleWarn;
  consoleSuppressed = false;
};
