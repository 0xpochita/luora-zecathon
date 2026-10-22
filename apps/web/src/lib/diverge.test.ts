import { describe, expect, it } from "vitest";
import { compareBackends, nodeName, statusText, type BackendSource } from "./diverge";

function chain(tip: number, forkAt = Infinity, tag = "b"): string[] {
  return Array.from({ length: tip + 1 }, (_, height) => (height >= forkAt ? `${tag}${height}` : `a${height}`));
}

function fake(label: string, hashes: string[], options: { chain?: string; down?: boolean } = {}) {
  const source: BackendSource & { lookups: number } = {
    label,
    lookups: 0,
    info: async () => {
      if (options.down) throw new Error("GetLightdInfo: the indexer is unreachable");
      return { vendor: "fake", version: "v1", build: "v1", subversion: "/Fake:1/", chain: options.chain ?? "main" };
    },
    tip: async () => ({ height: hashes.length - 1, hash: hashes[hashes.length - 1] }),
    hashAt: async (height) => {
      source.lookups += 1;
      if (height >= hashes.length) throw new Error("GetBlock: out of range");
      return hashes[height];
    },
  };
  return source;
}

describe("compareBackends", () => {
  it("reports agreement when every backend has the same tip", async () => {
    const result = await compareBackends([fake("a", chain(5000)), fake("b", chain(5000))], { chain: "main" });
    expect(result.reference).toBe("a");
    expect(result.tipHeight).toBe(5000);
    expect(result.backends.map((each) => [each.status, each.lag, each.calls])).toEqual([
      ["agree", 0, 0],
      ["agree", 0, 0],
    ]);
    expect(result.backends[0].reference).toBe(true);
  });

  it("reports lag on the same chain, including a lagging reference", async () => {
    const result = await compareBackends([fake("ref", chain(4990)), fake("ahead", chain(5000)), fake("behind", chain(4950))], {
      chain: "main",
    });
    expect(result.tipHeight).toBe(5000);
    expect(result.backends.map((each) => [each.label, each.status, each.lag])).toEqual([
      ["ref", "lagging", 10],
      ["ahead", "agree", 0],
      ["behind", "lagging", 50],
    ]);
  });

  it("finds the exact fork height within the call budget", async () => {
    const other = fake("forked", chain(5003, 4637));
    const result = await compareBackends([fake("ref", chain(5000)), other], { chain: "main" });
    const forked = result.backends[1];
    expect(forked.status).toBe("diverged");
    expect(forked.fork).toEqual({ lastCommon: 4636, height: 4637, exact: true, referenceHash: "a4637", hash: "b4637" });
    expect(forked.calls).toBeLessThanOrEqual(40);
    expect(other.lookups).toBeLessThanOrEqual(20);
    expect(result.tipHeight).toBe(5000);
    expect(forked.lag).toBe(-3);
  });

  it("finds a fork right at the shared tip", async () => {
    const result = await compareBackends([fake("ref", chain(5000)), fake("forked", chain(5000, 5000))], { chain: "main" });
    expect(result.backends[1].fork).toMatchObject({ lastCommon: 4999, height: 5000, exact: true });
  });

  it("says the fork is deeper than the window when the floor already differs", async () => {
    const result = await compareBackends([fake("ref", chain(5000)), fake("forked", chain(5000, 3000))], {
      chain: "main",
      window: 1000,
    });
    expect(result.backends[1].fork).toMatchObject({ lastCommon: null, height: 4000, exact: false });
  });

  it("reports a range when the call budget runs out", async () => {
    const result = await compareBackends([fake("ref", chain(5000)), fake("forked", chain(5000, 4637))], {
      chain: "main",
      maxCalls: 8,
    });
    const fork = result.backends[1].fork!;
    expect(fork.exact).toBe(false);
    expect(fork.lastCommon!).toBeLessThan(4637);
    expect(fork.height).toBeGreaterThanOrEqual(4637);
    expect(result.backends[1].calls).toBeLessThanOrEqual(8);
  });

  it("marks unreachable and wrong-chain backends and skips them as reference", async () => {
    const result = await compareBackends(
      [fake("down", chain(5000), { down: true }), fake("testnet", chain(5000), { chain: "test" }), fake("up", chain(5000))],
      { chain: "main" },
    );
    expect(result.reference).toBe("up");
    expect(result.backends.map((each) => each.status)).toEqual(["unreachable", "unreachable", "agree"]);
    expect(result.backends[0].error).toMatch(/unreachable/);
    expect(result.backends[1].error).toMatch(/test chain/);
  });

  it("returns no reference when nothing answers", async () => {
    const result = await compareBackends([fake("down", chain(10), { down: true })], { chain: "main" });
    expect(result.reference).toBeNull();
    expect(result.backends[0].status).toBe("unreachable");
  });

  it("measures latency per backend", async () => {
    let clock = 0;
    const result = await compareBackends([fake("a", chain(10))], { chain: "main", now: () => (clock += 7) });
    expect(result.backends[0].latencyMs).toBe(7);
  });
});

describe("status text", () => {
  const base = { label: "x", reference: false, info: null, tipHeight: 1, tipHash: "h", latencyMs: 1, calls: 0, error: null };
  const fork = { referenceHash: "a", hash: "b" };

  it("describes each status", () => {
    expect(statusText({ ...base, status: "agree", lag: 0, fork: null })).toBe("agree");
    expect(statusText({ ...base, status: "lagging", lag: 1, fork: null })).toBe("lagging 1 block");
    expect(statusText({ ...base, status: "lagging", lag: 1200, fork: null })).toBe("lagging 1,200 blocks");
    expect(statusText({ ...base, status: "unreachable", lag: null, fork: null })).toBe("unreachable");
    expect(statusText({ ...base, status: "diverged", lag: 0, fork: { ...fork, lastCommon: 9, height: 10, exact: true } })).toBe("diverged at 10");
    expect(statusText({ ...base, status: "diverged", lag: 0, fork: { ...fork, lastCommon: null, height: 4000, exact: false } })).toBe(
      "diverged at or below 4,000",
    );
    expect(statusText({ ...base, status: "diverged", lag: 0, fork: { ...fork, lastCommon: 9, height: 20, exact: false } })).toBe(
      "diverged between 10 and 20",
    );
  });

  it("names the node from the subversion string", () => {
    const info = { vendor: "ECC LightWalletD", version: "v0.5.5", build: "v1.7.0", chain: "main" };
    expect(nodeName({ ...info, subversion: "/Zakura:1.7.0/" })).toBe("Zakura 1.7.0");
    expect(nodeName({ ...info, subversion: "" })).toBeNull();
  });
});
