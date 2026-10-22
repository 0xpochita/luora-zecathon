import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import { lookupBlock, parseBlockRef, readBlockRequest, summarizeBlock, type BlockFetchers } from "./block";
import type { CompactBlock, CompactTx } from "./indexer";

const HASH = "000000000007d646150f880c69e6d88f543d1e369bd8b4fcf00ec6d394a80463";
const PREV = "00000000005d5046d2c1f1aa15a17bd69efdca5bb74d56988bd93fd096836bb3";
const COINBASE = "85aa012ca45c6becab13d7bd647108a0221c6ee3231bc80034a285c118b21597";

function internal(display: string): Buffer {
  return Buffer.from(display, "hex").reverse();
}

function compactTx(index: number, txid: string, parts: Partial<CompactTx> = {}): CompactTx {
  return { index: String(index), txid: internal(txid), fee: 0, spends: [], outputs: [], actions: [], ironwoodActions: [], vin: [], vout: [], ...parts };
}

const BLOCK: CompactBlock = {
  height: "3526161",
  hash: internal(HASH),
  prevHash: internal(PREV),
  time: 1792633313,
  vtx: [
    compactTx(0, COINBASE, { vout: [{ value: "1", scriptPubKey: Buffer.alloc(0) }] }),
    compactTx(1, HASH.replace(/^0+/, "f".repeat(13)), {
      spends: [{}],
      outputs: [{}, {}],
      actions: [{ nullifier: Buffer.alloc(32), cmx: Buffer.alloc(32) }],
      vin: [{ prevoutTxid: Buffer.alloc(32), prevoutIndex: 0 }],
    }),
  ],
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/block", { method: "POST", body: JSON.stringify(body) });
}

describe("block reference validation", () => {
  it("accepts a 64-hex hash in either case and a decimal height", () => {
    expect(parseBlockRef(HASH.toUpperCase())).toEqual({ hash: HASH });
    expect(parseBlockRef("3526161")).toEqual({ height: 3526161 });
  });

  it("rejects zero, padding, signs, decimals and oversized heights", () => {
    for (const value of ["0", "007", "-1", "+5", "1.5", "1e6", " 12", "99999999999", HASH.slice(1), `0x${HASH.slice(2)}`, ""]) {
      expect(parseBlockRef(value)).toBeNull();
    }
  });

  it("reads a block request and refuses a missing block field", async () => {
    await expect(readBlockRequest(request({ block: "42", network: "test" }))).resolves.toEqual({ ref: { height: 42 }, network: "test" });
    await expect(readBlockRequest(request({ block: 42 }))).rejects.toMatchObject({ code: "bad_request" });
    await expect(readBlockRequest(request({ block: "42", network: "regtest" }))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("block summary", () => {
  it("shows hashes in display order and counts each pool per transaction", () => {
    const view = summarizeBlock(BLOCK, "main");
    expect(view).toMatchObject({ network: "main", height: 3526161, hash: HASH, prevHash: PREV, time: 1792633313 });
    expect(view.txs[0]).toMatchObject({ txid: COINBASE, coinbase: true, transparentInputs: 0, transparentOutputs: 1 });
    expect(view.txs[1]).toMatchObject({ coinbase: false, transparentInputs: 1, saplingSpends: 1, saplingOutputs: 2, orchardActions: 1, ironwoodActions: 0 });
  });

  it("reports a missing previous hash and time as unknown", () => {
    const view = summarizeBlock({ ...BLOCK, prevHash: Buffer.alloc(0), time: 0 }, "test");
    expect(view.prevHash).toBeNull();
    expect(view.time).toBeNull();
  });
});

describe("block lookup", () => {
  const fetchers = (hashHeight: BlockFetchers["hashHeight"]): BlockFetchers => ({ block: async () => BLOCK, hashHeight });

  it("resolves a hash to a height, then checks the fetched block carries that hash", async () => {
    const view = await lookupBlock("main", { hash: HASH }, fetchers(async () => 3526161));
    expect(view.height).toBe(3526161);
    await expect(lookupBlock("main", { hash: PREV }, fetchers(async () => 3526161))).rejects.toMatchObject({ code: "not_found" });
  });

  it("turns an indexer refusal into not found", async () => {
    const refuse = async (): Promise<number> => {
      throw new ApiError("bad_request", "GetTreeState: the indexer rejected the request");
    };
    await expect(lookupBlock("test", { hash: HASH }, fetchers(refuse))).rejects.toMatchObject({ code: "not_found" });
  });
});
