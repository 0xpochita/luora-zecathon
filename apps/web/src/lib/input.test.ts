import { describe, expect, it } from "vitest";
import { classifyInput } from "./input";

const txid = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

describe("classifyInput routes one box to the right view", () => {
  it("detects a txid, raw hex, a PCZT and a Zebra error", () => {
    expect(classifyInput(` ${txid.toUpperCase()} `)).toEqual({ kind: "txid", txid });
    expect(classifyInput("0400008085202f89\n0100")).toEqual({ kind: "hex", hex: "0400008085202f890100" });
    expect(classifyInput("50435a5401000000").kind).toBe("pczt");
    expect(classifyInput("transaction uses an incorrect consensus branch id")).toEqual({
      kind: "error",
      text: "transaction uses an incorrect consensus branch id",
    });
    expect(classifyInput("TransactionError::ExpiredTransaction").kind).toBe("error");
    expect(classifyInput("abc").kind).toBe("invalid");
    expect(classifyInput("   ").kind).toBe("empty");
  });
});
