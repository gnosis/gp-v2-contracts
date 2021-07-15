import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { BigNumber } from "ethers";

import { OrderKind } from "../../src/ts";

import { MockApi } from "./mock_api";

chai.use(chaiAsPromised);

describe("MockApi", () => {
  let api = new MockApi();

  const feeInput = {
    sellToken: "0x" + "42".repeat(20),
    buyToken: "0x" + "21".repeat(20),
    kind: OrderKind.SELL,
    amount: 31337,
  };
  const feeOutput = BigNumber.from(42);
  const feeError = {
    errorType: "MockError",
    description: "a mocked error",
  };

  beforeEach(() => {
    api = new MockApi();
  });

  it("mocks successful api calls", async () => {
    api.mock.getFee.withArgs(feeInput).returns(feeOutput);
    await expect(api.getFee(feeInput)).to.eventually.deep.equal(feeOutput);
  });

  describe("mocks failing api calls", () => {
    it("with error", async () => {
      api.mock.getFee.withArgs(feeInput).throwsWith(feeError);
      await expect(api.getFee(feeInput))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.have.deep.property("apiError", feeError);
    });

    it("without error", async () => {
      api.mock.getFee.withArgs(feeInput).throws();
      await expect(api.getFee(feeInput))
        .to.eventually.be.rejected.and.be.an.instanceOf(Error)
        .and.not.have.property("apiError");
    });
  });

  it("throws if no expectations are set", async () => {
    expect(() => api.getFee(feeInput)).to.throw();
  });

  describe("cannot set related parameters twice", () => {
    it("input values", async () => {
      const builder = api.mock.getFee.withArgs(feeInput);
      expect(() => builder.withArgs(feeInput)).to.throw();
    });

    it("output values", async () => {
      const builder = api.mock.getFee.returns(feeOutput);
      expect(() => builder.returns(feeOutput)).to.throw();
    });

    it("errors", async () => {
      const builder = api.mock.getFee.throws();
      expect(() => builder.throwsWith(feeError)).to.throw();
    });

    it("output and error", async () => {
      const builder = api.mock.getFee.throws();
      expect(() => builder.returns(feeOutput)).to.throw();
    });
  });

  it("single expectation can only be called once", async () => {
    api.mock.getFee.withArgs(feeInput).returns(feeOutput);
    await api.getFee(feeInput);
    expect(() => api.getFee(feeInput)).to.throw();
  });

  it("multiple expectations", async () => {
    api.mock.getFee
      .withArgs({ ...feeInput, amount: 42 })
      .returns(BigNumber.from(1337));
    api.mock.getFee
      .withArgs({ ...feeInput, amount: 43 })
      .returns(BigNumber.from(31337));
    await expect(
      api.getFee({ ...feeInput, amount: 42 }),
    ).to.eventually.deep.equal(BigNumber.from(1337));
    await expect(
      api.getFee({ ...feeInput, amount: 43 }),
    ).to.eventually.deep.equal(BigNumber.from(31337));
  });

  describe("call order", () => {
    it("is enforced by default", async () => {
      api.mock.getFee
        .withArgs({ ...feeInput, amount: 42 })
        .returns(BigNumber.from(1337));
      api.mock.getFee
        .withArgs({ ...feeInput, amount: 43 })
        .returns(BigNumber.from(31337));
      expect(() => api.getFee({ ...feeInput, amount: 43 })).to.throw();
    });

    it("can be disabled", async () => {
      api.mock.getFee
        .withArgs({ ...feeInput, amount: 42 })
        .returns(BigNumber.from(1337));
      api.mock.getFee
        .withArgs({ ...feeInput, amount: 43 })
        .returns(BigNumber.from(31337));
      api.mock.ignoreExpectationOrder();
      await expect(
        api.getFee({ ...feeInput, amount: 43 }),
      ).to.eventually.deep.equal(BigNumber.from(31337));
      await expect(
        api.getFee({ ...feeInput, amount: 42 }),
      ).to.eventually.deep.equal(BigNumber.from(1337));
    });
  });

  it("all expectations used", async () => {
    api.mock.getFee.withArgs(feeInput).returns(BigNumber.from(1337));
    api.mock.getFee.withArgs(feeInput).returns(BigNumber.from(31337));
    expect(() => api.mock.assertAllExpectationsUsed()).to.throw();
    api.getFee(feeInput);
    expect(() => api.mock.assertAllExpectationsUsed()).to.throw();
    api.getFee(feeInput);
    expect(() => api.mock.assertAllExpectationsUsed()).not.to.throw();
  });
});
