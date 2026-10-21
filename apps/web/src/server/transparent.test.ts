import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/mainnet-transactions.json";
import { readTransparentBundle } from "./transparent";

const transactions: Record<string, { height: number | null; hex: string }> = fixtures.transactions;
const IRONWOOD_TXID = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

function raw(txid: string): Buffer {
  return Buffer.from(transactions[txid].hex, "hex");
}

describe("transparent bundle reader on real mainnet transactions", () => {
  it("reads the v6 Ironwood transaction's inputs in display byte order", () => {
    const bundle = readTransparentBundle(raw(IRONWOOD_TXID));
    expect(bundle.version).toBe(6);
    expect(bundle.inputs).toEqual([
      { prevTxid: "c533f8ac534d990811cbd5a171fcb9ab818e53d74cc9e3d540a518ba9e9aa42c", prevIndex: 1, isCoinbase: false },
      { prevTxid: "7916ea90a21eee006743a0f191f22eca260982c22bd398c2cb00d0e5acd4733a", prevIndex: expect.any(Number), isCoinbase: false },
    ]);
  });

  it("finds every parent transaction among the fixtures and reads its outputs", () => {
    for (const input of readTransparentBundle(raw(IRONWOOD_TXID)).inputs) {
      const parent = readTransparentBundle(raw(input.prevTxid));
      expect(parent.outputs.length).toBeGreaterThan(input.prevIndex);
      for (const output of parent.outputs) {
        expect(Number.isSafeInteger(output.valueZat)).toBe(true);
        expect(output.valueZat).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("throws on a truncated transaction instead of guessing", () => {
    const truncated = raw(IRONWOOD_TXID).subarray(0, 60);
    expect(() => readTransparentBundle(truncated)).toThrow(/ends early/);
  });
});
