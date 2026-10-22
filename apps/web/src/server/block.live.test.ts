import { describe, expect, it } from "vitest";
import { lookupBlock } from "./block";

const HASH = "000000000007d646150f880c69e6d88f543d1e369bd8b4fcf00ec6d394a80463";

describe.skipIf(!process.env.LIVE)("live block lookup (LIVE=1)", () => {
  it("finds mainnet block 3,526,161 by hash and by height", async () => {
    const byHash = await lookupBlock("main", { hash: HASH });
    expect(byHash.height).toBe(3526161);
    expect(byHash.txs[0].coinbase).toBe(true);
    const byHeight = await lookupBlock("main", { height: 3526161 });
    expect(byHeight.hash).toBe(HASH);
    expect(byHeight.prevHash).toBe(byHash.prevHash);
  });

  it("says not found for a mainnet hash on testnet and for a height past the tip", async () => {
    await expect(lookupBlock("test", { hash: HASH })).rejects.toMatchObject({ code: "not_found" });
    await expect(lookupBlock("main", { height: 999_999_999 })).rejects.toMatchObject({ code: "not_found" });
  });
});
