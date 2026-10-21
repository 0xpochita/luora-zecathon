import { describe, expect, it } from "vitest";
import samples from "../../../../data/samples.json";
import upgrades from "../../../../data/upgrades.json";
import { getLightdInfo, getTransaction } from "./indexer";
import { prevoutValues } from "./prevouts";
import { upgradeAtHeight } from "./upgrades";

describe.skipIf(!process.env.LIVE)("live indexers (LIVE=1)", () => {
  it.each(["main", "test"] as const)("%s reports a branch ID that matches upgrades.json at its tip", async (network) => {
    const info = await getLightdInfo(network);
    const height = Number(info.blockHeight);
    expect(height).toBeGreaterThan(upgrades.source.crossChecked.lightwalletd[network].height - 1);
    expect(`0x${info.consensusBranchId}`).toBe(upgradeAtHeight(network, height)?.branchId);
  });

  it.each(samples.map((sample) => [sample.label, sample] as const))("serves sample %s at its recorded height", async (_, sample) => {
    const { raw, height } = await getTransaction(sample.network as "main" | "test", sample.txid);
    expect(height).toBe(sample.height);
    expect(raw.length).toBeGreaterThan(0);
  });

  it("computes prevout values for the transparent sample", async () => {
    const sample = samples.find((each) => each.label === "Transparent only")!;
    const { raw } = await getTransaction("main", sample.txid);
    const values = await prevoutValues("main", raw);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === "number" && value > 0)).toBe(true);
  });
});
