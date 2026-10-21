import { describe, expect, it } from "vitest";
import { displayTxidToInternalBytes, internalBytesToDisplayTxid, isTxid } from "./txid";

const IRONWOOD_TXID = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

describe("txid validation", () => {
  it("accepts 64 hex characters in either case", () => {
    expect(isTxid(IRONWOOD_TXID)).toBe(true);
    expect(isTxid(IRONWOOD_TXID.toUpperCase())).toBe(true);
  });

  it("rejects wrong lengths, non-hex and padding", () => {
    expect(isTxid(IRONWOOD_TXID.slice(1))).toBe(false);
    expect(isTxid(`${IRONWOOD_TXID}0`)).toBe(false);
    expect(isTxid(`${IRONWOOD_TXID.slice(1)}g`)).toBe(false);
    expect(isTxid(` ${IRONWOOD_TXID.slice(1)}`)).toBe(false);
    expect(isTxid(`0x${IRONWOOD_TXID.slice(2)}`)).toBe(false);
    expect(isTxid("")).toBe(false);
  });
});

describe("txid byte order", () => {
  it("reverses display order into the internal order the indexer expects", () => {
    const internal = displayTxidToInternalBytes(IRONWOOD_TXID);
    expect(internal.toString("hex")).toBe("1c02fcf1a984e4f7e64bf49dc0b24d6db5e0178f07471e8bfa394bc21fd4cd30");
    expect(internalBytesToDisplayTxid(internal)).toBe(IRONWOOD_TXID);
  });

  it("refuses to convert an invalid txid", () => {
    expect(() => displayTxidToInternalBytes("abc")).toThrow();
  });
});
