import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/mainnet-transactions.json";
import { prevoutValues } from "./prevouts";
import { readTransparentBundle } from "./transparent";

const transactions: Record<string, { height: number | null; hex: string }> = fixtures.transactions;
const IRONWOOD_TXID = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

async function fromFixtures(_network: string, txid: string) {
  const fixture = transactions[txid];
  if (!fixture) throw new Error("not in fixtures");
  return { raw: Buffer.from(fixture.hex, "hex") };
}

describe("prevout values", () => {
  it("returns the spent output value for every transparent input", async () => {
    const raw = Buffer.from(transactions[IRONWOOD_TXID].hex, "hex");
    const values = await prevoutValues("main", raw, fromFixtures);
    const expected = readTransparentBundle(raw).inputs.map(
      (input) => readTransparentBundle(Buffer.from(transactions[input.prevTxid].hex, "hex")).outputs[input.prevIndex].valueZat,
    );
    expect(values).toEqual(expected);
    expect(values.every((value) => typeof value === "number" && value > 0)).toBe(true);
  });

  it("returns null for an input whose parent cannot be fetched", async () => {
    const raw = Buffer.from(transactions[IRONWOOD_TXID].hex, "hex");
    const values = await prevoutValues("main", raw, async (network, txid) =>
      txid.startsWith("c533") ? Promise.reject(new Error("unavailable")) : fromFixtures(network, txid),
    );
    expect(values[0]).toBeNull();
    expect(typeof values[1]).toBe("number");
  });
});
