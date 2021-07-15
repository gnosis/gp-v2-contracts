import deepEqual from "deep-equal";

import { Api, ApiError, CallError } from "../../src/services/api";

type MockableMethod = keyof Api;
const mockableMethods = Object.getOwnPropertyNames(Api.prototype).filter(
  (method) => method !== "constructor",
) as MockableMethod[];

type MethodInput<T extends MockableMethod> = Api[T] extends (
  input: infer U,
) => unknown
  ? U
  : never;
type MethodOutput<T extends MockableMethod> = Api[T] extends (
  ...args: never
) => Promise<infer U>
  ? U
  : never;

interface MockMethodParams<T extends MockableMethod> {
  input?: MethodInput<T>;
  output?: MethodOutput<T>;
  error?: ApiError;
}

type EvalMethod<T extends MockableMethod> =
  | { isError: true; error: CallError }
  | { isError: false; output: MethodOutput<T> };

/// A class representing a single instance of a call to some API method. It
/// stores the input and output of the single call as they are specified.
/// This class can be used with the builder pattern to concatenate multiple
/// expectations for the same call on the same line.
class MockMethodBuilder<T extends MockableMethod> {
  /// The parameters of the calls that have been specified so far.
  params: MockMethodParams<T> = {};

  constructor(readonly methodName: string) {}

  withArgs(input: MethodInput<T>): this {
    if ("input" in this.params) {
      throw new Error("mock input already set");
    }
    this.params.input = input;
    return this;
  }

  returns(output: MethodOutput<T>): this {
    if ("output" in this.params || "error" in this.params) {
      throw new Error("mock output already set");
    }
    this.params.output = output;
    return this;
  }

  throws(): this {
    if ("output" in this.params || "error" in this.params) {
      throw new Error("mock output already set");
    }
    this.params.error = undefined;
    return this;
  }

  throwsWith(error: ApiError): this {
    if ("output" in this.params || "error" in this.params) {
      throw new Error("mock output already set");
    }
    this.params.error = error;
    return this;
  }
}

/// This class collects all expected calls to any API method and computes the
/// result of executing any of the mocked functions. This class will be extended
/// later with an inizializer function for each mockable method.
class BaseMockInitializer {
  private calls: MockMethodBuilder<MockableMethod>[] = [];
  private ignoreOrder = false;

  ignoreExpectationOrder() {
    this.ignoreOrder = true;
  }

  assertAllExpectationsUsed() {
    if (this.calls.length !== 0) {
      throw new Error(
        `${this.calls.length} of the expectations that were set for the mock API were not used`,
      );
    }
  }

  verifyAndEval<T extends MockableMethod>(
    methodName: T,
    input: MethodInput<T>,
  ): EvalMethod<T> {
    const callIndex = this.calls.findIndex(
      (call) =>
        call.methodName === methodName &&
        "input" in call.params &&
        deepEqual(call.params.input, input),
    );
    if (callIndex === -1) {
      throw new Error(
        `No expectations available for mocking method ${methodName} with input ${JSON.stringify(
          input,
        )}`,
      );
    } else {
      if (callIndex !== 0 && !this.ignoreOrder) {
        throw new Error(
          `Call to ${methodName} with input ${JSON.stringify(
            input,
          )} out of order. Expected ${callIndex} call${
            callIndex > 1 ? "s" : ""
          } before this`,
        );
      }
    }
    const call = this.calls[callIndex];
    this.calls = [
      ...this.calls.slice(0, callIndex),
      ...this.calls.slice(callIndex + 1),
    ];
    if ("error" in call.params) {
      const error: CallError = new Error("Mock api returns expected error");
      if (call.params.error !== undefined) {
        error.apiError = call.params.error;
      }
      return { isError: true, error };
    }
    if ("output" in call.params) {
      // output is `undefined` only if the output is expected to be `undefined`.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return { isError: false, output: call.params.output! };
    }
    throw new Error(
      `Api mocked method ${methodName} was requested as expected but its output is not defined`,
    );
  }
}

// https://www.typescriptlang.org/docs/handbook/2/mapped-types.html
type MappedMocks = {
  [Method in MockableMethod]: MockMethodBuilder<Method>;
};

// Programmatically extend BaseMockInitializer to include all mocked methods,
// each of which returns the corresponding MockMethodBuilder.
type MockInitializer = BaseMockInitializer & MappedMocks;
export const MockInitializer = class MockInitializer extends BaseMockInitializer {} as new (
  ...args: ConstructorParameters<typeof BaseMockInitializer>
) => MockInitializer;

for (const method of mockableMethods) {
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get#defining_a_getter_on_existing_objects_using_defineproperty
  Object.defineProperty(MockInitializer.prototype, method, {
    get: function () {
      const mockMethod = new MockMethodBuilder(method);
      this.calls.push(mockMethod);
      return mockMethod;
    },
  });
}

class BaseMockApi {
  network = "mock network";
  mock = new MockInitializer();
}

// Programmatically extend BaseMockApi to include all mocked methods. Each
// method call verifies any mock expectation and returns the expected value.
type MockApi = BaseMockApi & Api;
export const MockApi = class MockApi extends BaseMockApi {} as new (
  ...args: ConstructorParameters<typeof BaseMockApi>
) => MockApi;

for (const method of mockableMethods) {
  const mockMethod = function (
    this: BaseMockApi,
    input: MethodInput<typeof method>,
  ) {
    const result: EvalMethod<typeof method> = this.mock.verifyAndEval(
      method,
      input,
    );
    if (result.isError === false) {
      return Promise.resolve(result.output);
    } else {
      return Promise.reject(result.error);
    }
  };
  MockApi.prototype[method] = mockMethod;
}
