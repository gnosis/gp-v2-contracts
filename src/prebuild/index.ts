/**
 * Automatically creates validator functions from TS type definitions at compile
 * time.
 */

import TJV from "typescript-json-validator";

interface TypeToValidate {
  path: string;
  name: string;
}

// TODO: automatic detection of types that need a validator
const typesToValidate: TypeToValidate[] = [
  { path: "./src/tasks/withdraw-service/state.ts", name: "State" },
];

for (const { path, name } of typesToValidate) {
  TJV([path, name]);
}
