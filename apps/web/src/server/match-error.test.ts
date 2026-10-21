import { describe, expect, it } from "vitest";
import type { ZebraErrorEntry } from "../../../../contract/types";
import catalogJson from "../../../../data/zebra-errors.json";
import samplesJson from "../../../../data/zebra-error-samples.json";
import { matchError } from "./match-error";

const catalog = catalogJson as ZebraErrorEntry[];
const rejected = samplesJson.samples.filter((sample) => !sample.accepted && sample.response);

describe("error matching against real zebrad 7.0.0-rc.0 regtest rejections", () => {
  it("has real samples to test with", () => {
    expect(rejected.length).toBeGreaterThanOrEqual(10);
  });

  for (const sample of rejected) {
    it(`ranks ${sample.expectedVariant} first for ${sample.id}`, () => {
      const matches = matchError(sample.response!.message, catalog);
      expect(matches[0]?.entry.variant).toBe(sample.expectedVariant);
    });
  }

  it("also matches the full JSON-RPC error body a user would paste", () => {
    const sample = rejected.find((each) => each.id === "wrong-branch-id")!;
    const pasted = JSON.stringify({ jsonrpc: "2.0", error: sample.response, id: 1 });
    expect(matchError(pasted, catalog)[0].entry.variant).toBe("TransactionError::WrongConsensusBranchId");
  });

  it("keeps the wrapping errors in the ranking, after the specific one", () => {
    const sample = rejected.find((each) => each.id === "immature-coinbase")!;
    const variants = matchError(sample.response!.message, catalog, 10).map((match) => match.entry.variant);
    expect(variants[0]).toBe("ValidateContextError::ImmatureTransparentCoinbaseSpend");
    expect(variants).toContain("TransactionError::ValidateContextError");
  });

  it("recognises a Debug-formatted log line by variant name", () => {
    const logLine =
      'Transaction(InternalDowncastError("downcast to known transaction error type failed, original error: Elapsed(())"))';
    expect(matchError(logLine, catalog)[0].entry.variant).toBe("TransactionError::InternalDowncastError");
  });

  it("returns nothing for text that is not a Zebra error", () => {
    expect(matchError("hello world", catalog)).toEqual([]);
    expect(matchError("   ", catalog)).toEqual([]);
  });
});
