import { describe, expect, it } from "vitest";
import { compareBackends } from "../lib/diverge";
import { backendSource } from "./indexer";
import { compareEndpoints } from "./networks";

describe.skipIf(!process.env.LIVE)("live backend comparison (LIVE=1)", () => {
  it("finds the allowlisted mainnet backends on one chain", async () => {
    const sources = compareEndpoints("main").map((endpoint) => backendSource(endpoint, 5_000));
    const result = await compareBackends(sources, { chain: "main" });
    expect(result.backends.filter((each) => each.status !== "unreachable").length).toBeGreaterThanOrEqual(2);
    expect(result.backends.filter((each) => each.status === "diverged").map((each) => each.label)).toEqual([]);
  });
});
