import { describe, expect, it } from "vitest";
import { classifyInput, isBlockRef } from "./input";

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

describe("block heights and block references", () => {
  it("reads a decimal height, with or without thousands separators", () => {
    expect(classifyInput("3526161")).toEqual({ kind: "block", block: "3526161" });
    expect(classifyInput(" 3,526,161 ")).toEqual({ kind: "block", block: "3526161" });
    expect(classifyInput("1")).toEqual({ kind: "block", block: "1" });
  });

  it("keeps hex that only looks numeric and rejects heights it cannot use", () => {
    expect(classifyInput("0400").kind).toBe("hex");
    expect(classifyInput("123456789012").kind).toBe("hex");
    expect(classifyInput("0").kind).toBe("invalid");
    expect(classifyInput(txid).kind).toBe("txid");
  });

  it("accepts a lowercase 64-hex hash or a height in a shared link", () => {
    expect(isBlockRef(txid)).toBe(true);
    expect(isBlockRef("3526161")).toBe(true);
    expect(isBlockRef("0")).toBe(false);
    expect(isBlockRef(txid.toUpperCase())).toBe(false);
    expect(isBlockRef(null)).toBe(false);
  });
});
