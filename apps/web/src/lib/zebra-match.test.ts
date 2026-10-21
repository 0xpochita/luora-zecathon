import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ZebraErrorEntry } from "../../../../contract/types";
import { matchZebraError } from "./zebra-match";

const catalog: ZebraErrorEntry[] = JSON.parse(
  readFileSync(path.join(__dirname, "../../../../data/zebra-errors.json"), "utf8"),
);

describe("matchZebraError against the extracted Zebra catalog", () => {
  it("ranks the exact message first", () => {
    const [top] = matchZebraError("transaction uses an incorrect consensus branch id", catalog);
    expect(top.entry.variant).toBe("TransactionError::WrongConsensusBranchId");
  });

  it("fills placeholders of a templated message", () => {
    const message =
      "transaction must not be mined at a block Height(3525555) greater than its expiry Height(3497099), failing transaction 30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";
    const [top] = matchZebraError(message, catalog);
    expect(top.entry.variant).toBe("TransactionError::ExpiredTransaction");
    expect(top.reason).toBe("message template");
  });

  it("finds a variant by name", () => {
    const [top] = matchZebraError("Err(ExpiredTransaction)", catalog);
    expect(top.entry.variant.endsWith("ExpiredTransaction")).toBe(true);
  });

  it("returns nothing for unrelated text", () => {
    expect(matchZebraError("hello world", catalog)).toEqual([]);
  });
});

describe("matchZebraError with a cut-off message", () => {
  it("still matches the template prefix", () => {
    const [top] = matchZebraError(
      "transaction must not be mined at a block Height(3525555) greater than its expiry Height(3497099)",
      catalog,
    );
    expect(top.entry.variant).toBe("TransactionError::ExpiredTransaction");
    expect(top.reason).toBe("message template");
  });

  it("matches a pasted variant path only to that variant, not to shorter names inside it", () => {
    const matches = matchZebraError("TransactionError::ExpiredTransaction", catalog);
    expect(matches.map((match) => match.entry.variant)).toEqual(["TransactionError::ExpiredTransaction"]);
  });
});
