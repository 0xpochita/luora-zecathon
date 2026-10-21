import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LuoraZCore, TraceNode } from "../../../../contract/types";
import { expandedFor, failingRows, traceRows, visibleRows } from "./trace";

const wasmDir = path.join(__dirname, "../../public/wasm");
const mainnet = JSON.parse(readFileSync(path.join(__dirname, "../server/fixtures/mainnet-transactions.json"), "utf8"));
const ironwoodTxid = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

let core: LuoraZCore;
let nodes: TraceNode[];

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  core = wasm as unknown as LuoraZCore;
  nodes = core.trace_tx(mainnet.transactions[ironwoodTxid].hex, "main");
});

describe("trace rows from the real v6 Ironwood transfer (mainnet height 3,495,600)", () => {
  it("starts at byte 0 and ends at the transaction size", () => {
    const hex: string = mainnet.transactions[ironwoodTxid].hex;
    expect(nodes[0]).toMatchObject({ id: "tx", kind: "TX", offset: 0, length: hex.length / 2 });
    const top = nodes.filter((node) => node.parentId === "tx");
    expect(top.map((node) => node.kind)).toEqual(["HEADER", "TRANSPARENT", "SAPLING", "ORCHARD", "IRONWOOD"]);
    const last = top[top.length - 1];
    expect(last.offset + last.length).toBe(hex.length / 2);
  });

  it("adds prevout values to VIN rows and a fee row", () => {
    const rows = traceRows(nodes, [509384, 595000], 15000, false);
    expect(rows.find((row) => row.id === "vin-0")!.fields[0]).toMatchObject({ name: "value", display: "0.00509384 ZEC" });
    expect(rows[rows.length - 1]).toMatchObject({ id: "fee", kind: "FEE", label: "0.00015 ZEC", offset: null });
  });

  it("expands by level and filters by search with ancestors kept", () => {
    const rows = traceRows(nodes, null, null, false);
    expect(visibleRows(rows, expandedFor(rows, "collapsed"), "").map((row) => row.id)).toEqual(["tx"]);
    const bundles = visibleRows(rows, expandedFor(rows, "bundles"), "");
    expect(bundles.every((row) => row.depth <= 1)).toBe(true);
    expect(visibleRows(rows, expandedFor(rows, "everything"), "").length).toBe(rows.length);
    const search = visibleRows(rows, expandedFor(rows, "collapsed"), "nullifier");
    expect(search.map((row) => row.id)).toEqual(["tx", "ironwood", "ironwood-action-0"]);
  });

  it("points a failing expiry check at the header row", () => {
    const checks = core.check_tx(mainnet.transactions[ironwoodTxid].hex, "main", 3525586, [null, null]);
    const failing = failingRows(checks);
    expect([...failing.keys()]).toContain("header");
  });
});
