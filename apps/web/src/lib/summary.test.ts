import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { DecodedTx, LuoraZCore } from "../../../../contract/types";
import { describeMovement, summarizeRules } from "./summary";

const wasmDir = path.join(__dirname, "../../public/wasm");
const mainnet = JSON.parse(readFileSync(path.join(__dirname, "../server/fixtures/mainnet-transactions.json"), "utf8"));
const coinbase = JSON.parse(readFileSync(path.join(__dirname, "../../../../crates/core/tests/fixtures/v4-coinbase.json"), "utf8"));
const ironwoodTxid = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";

let core: LuoraZCore;

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  core = wasm as unknown as LuoraZCore;
});

describe("verdict sentences from real mainnet transactions", () => {
  it("describes the v6 Ironwood transfer at height 3,495,600 as a move into Ironwood", () => {
    const hex = mainnet.transactions[ironwoodTxid].hex;
    const tx: DecodedTx = core.decode_tx(hex, "main");
    const inputs = tx.transparent.inputs.map(() => null);
    expect(describeMovement(tx, inputs, false)).toBe(
      `Moved ${(-tx.ironwood!.valueBalanceZat / 1e8).toString()} ZEC from transparent (public) into Ironwood (new shielded pool).`,
    );
  });

  it("describes the v4 coinbase at height 1,000,000 as a block reward", () => {
    const tx: DecodedTx = core.decode_tx(coinbase.hex, "main");
    expect(describeMovement(tx, [], false)).toMatch(/^Coinbase: the block reward, [\d.]+ ZEC paid to \d+ transparent output/);
  });

  it("counts real check results for the Ironwood transfer at its mined height", () => {
    const hex = mainnet.transactions[ironwoodTxid].hex;
    const tx: DecodedTx = core.decode_tx(hex, "main");
    const checks = core.check_tx(hex, "main", 3495600, tx.transparent.inputs.map(() => null));
    const summary = summarizeRules(checks, "when mined");
    expect(summary.failing).toHaveLength(0);
    expect(summary.text).toMatch(/^Valid when mined/);
    const later = summarizeRules(core.check_tx(hex, "main", 3525586, tx.transparent.inputs.map(() => null)), "at the current tip");
    expect(later.tone).toBe("bad");
    expect(later.failing.map((check) => check.id).join(" ")).toMatch(/expir/);
  });
});
