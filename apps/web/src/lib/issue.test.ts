import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LuoraZCore, ZebraErrorEntry } from "../../../../contract/types";
import { buildIssueMarkdown, issueTitle, LIBRUSTZCASH_REV, type IssueEnv } from "./issue";
import { buildShareLink, MAX_FRAGMENT_CHARS, readShareFragment } from "./share-link";
import { matchZebraError } from "./zebra-match";

const root = path.join(__dirname, "../../../..");
const wasmDir = path.join(__dirname, "../../public/wasm");
const mainnet = JSON.parse(readFileSync(path.join(__dirname, "../server/fixtures/mainnet-transactions.json"), "utf8"));
const catalog: ZebraErrorEntry[] = JSON.parse(readFileSync(path.join(root, "data/zebra-errors.json"), "utf8"));
const regtest = JSON.parse(readFileSync(path.join(root, "data/zebra-error-samples.json"), "utf8"));
const unsignedPczt = readFileSync(path.join(root, "crates/core/tests/fixtures/pczt/4-combined-unsigned.pczt")).toString("hex");
const ironwoodTxid = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";
const ironwoodHex: string = mainnet.transactions[ironwoodTxid].hex;
const ironwoodInputs = [509384, 595000];
const base = "https://luora.example/";

let core: LuoraZCore;

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  core = wasm as unknown as LuoraZCore;
});

function env(link: string, network: "main" | "test" = "main"): IssueEnv {
  return { network, link, versions: { librustzcash: LIBRUSTZCASH_REV, zebraCatalog: catalog[0].zebraVersion } };
}

describe("issue Markdown for the real v6 Ironwood transfer", () => {
  it("lists the failing expiry rule with its ZIP link and source line after the expiry height", () => {
    const checks = core.check_tx(ironwoodHex, "main", 3_497_100, ironwoodInputs);
    const link = buildShareLink(base, { kind: "txid", txid: ironwoodTxid, network: "main" }, false).url;
    const markdown = buildIssueMarkdown(
      {
        kind: "tx",
        txid: ironwoodTxid,
        source: "mined",
        minedHeight: 3_495_600,
        checkedAt: 3_497_100,
        heightLabel: "at height 3,497,100",
        verdict: "Moved 0.0035183 ZEC from transparent (public) into Ironwood (new shielded pool). Fee 0.00015 ZEC.",
        checks,
        mempool: [],
      },
      env(link),
    );
    expect(markdown.split("\n")[0]).toBe("## Mainnet transaction 30cdd41f…021c fails Expiry height at height 3,497,100");
    expect(markdown).toContain(`| Transaction | \`${ironwoodTxid}\` |`);
    expect(markdown).toContain("| Rules checked | at height 3,497,100 |");
    expect(markdown).toContain("| State | mined at 3,495,600 |");
    expect(markdown).toMatch(/- \*\*fail\*\* · Expiry height: .*3,497,099.* · \[ZIP 203.*\]\(https:\/\/zips\.z\.cash\/zip-0203.*\) · `.+`/);
    expect(markdown).toContain("librustzcash `8672a4b2`");
    expect(markdown).toContain("Zebra error catalog: Zebra v7.0.0-rc.0 (6d1e414d6f)");
    expect(markdown).toContain(`[Open in Luora](${base}?tx=${ironwoodTxid}&net=main)`);
  });

  it("never includes the hex of a pasted transaction", () => {
    const checks = core.check_tx(ironwoodHex, "main", 3_495_600, ironwoodInputs);
    const markdown = buildIssueMarkdown(
      { kind: "tx", txid: ironwoodTxid, source: "pasted", minedHeight: null, checkedAt: 3_495_600, heightLabel: "at height 3,495,600", verdict: "Valid.", checks, mempool: [] },
      env(base),
    );
    expect(markdown).toContain("unbroadcast hex, not included");
    expect(markdown).not.toContain(ironwoodHex.slice(0, 80));
    expect(markdown.split("\n")[0]).toBe("## Mainnet transaction 30cdd41f…021c passes all rules at height 3,495,600");
  });
});

describe("issue Markdown for a real zebrad rejection", () => {
  it("names the matched variant, its stage and the source link at the catalog commit", () => {
    const sample = regtest.samples.find((item: { id: string }) => item.id === "expired");
    const text: string = sample.response.message;
    const matches = matchZebraError(text, catalog);
    const markdown = buildIssueMarkdown({ kind: "error", text, matches, checkedAt: 3_526_665 }, env(base));
    expect(markdown.split("\n")[0]).toBe("## Zebra rejected a transaction: TransactionError::ExpiredTransaction");
    expect(markdown).toContain("- **TransactionError::ExpiredTransaction**, matched by");
    expect(markdown).toContain("- Stage: transaction");
    expect(markdown).toMatch(/\(https:\/\/github\.com\/ZcashFoundation\/zebra\/blob\/6d1e414d6f\/zebra-consensus\/src\/error\.rs#L\d+\)/);
    expect(markdown).toContain(text.trim());
  });
});

describe("issue Markdown for the real testnet PCZT that zcash-devtool left unsigned", () => {
  it("summarises the roles and flags the missing Ironwood signature", () => {
    const view = core.inspect_pczt(unsignedPczt, "test");
    const markdown = buildIssueMarkdown({ kind: "pczt", view, checkedAt: null }, env(base, "test"));
    const done = view.roles.filter((role) => role.done).length;
    expect(issueTitle({ kind: "pczt", view, checkedAt: null }, "test")).toMatch(new RegExp(`^Testnet PCZT: ${done} of 9 roles done, .*`));
    expect(markdown).toContain("### PCZT roles (ZIP 374)");
    expect(markdown).toContain("| ironwood |");
    expect(markdown).toMatch(/\*\*(warn|fail)\*\* · .*Ironwood action/);
    expect(markdown).toContain("| Transaction | PCZT, not included |");
    expect(markdown).not.toContain(unsignedPczt.slice(0, 80));
  });
});

describe("share links", () => {
  it("keeps a txid in the query string, as before", () => {
    expect(buildShareLink(base, { kind: "txid", txid: ironwoodTxid, network: "test" }, true)).toEqual({
      url: `${base}?tx=${ironwoodTxid}&net=test`,
      raw: "query",
    });
  });

  it("leaves raw hex out unless asked, and never puts it in the query string", () => {
    expect(buildShareLink(base, { kind: "hex", data: ironwoodHex, network: "main" }, false)).toEqual({ url: base, raw: "none" });
    const link = buildShareLink(base, { kind: "hex", data: ironwoodHex, network: "main" }, true);
    expect(link.raw).toBe("fragment");
    const url = new URL(link.url);
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#hex=")).toBe(true);
  });

  it("round-trips hex and a PCZT through the fragment", () => {
    const hexLink = new URL(buildShareLink(base, { kind: "hex", data: ironwoodHex, network: "main" }, true).url);
    expect(readShareFragment(hexLink.hash)).toEqual({ kind: "hex", data: ironwoodHex, network: "main" });
    const base64 = readFileSync(path.join(root, "crates/core/tests/fixtures/pczt/1-created.pczt")).toString("base64");
    expect(base64).toMatch(/[+/]/);
    const pcztLink = new URL(buildShareLink(base, { kind: "pczt", data: base64, network: "test" }, true).url);
    expect(readShareFragment(pcztLink.hash)).toEqual({ kind: "pczt", data: base64, network: "test" });
  });

  it("refuses a fragment that is too big and says how big it was", () => {
    const big = readFileSync(path.join(root, "crates/core/tests/fixtures/pczt/2-proven.pczt")).toString("hex");
    const link = buildShareLink(base, { kind: "pczt", data: big, network: "test" }, true);
    expect(link).toMatchObject({ url: base, raw: "too-big" });
    expect(link.raw === "too-big" && link.chars).toBeGreaterThan(MAX_FRAGMENT_CHARS);
  });

  it("ignores fragments that are not a transaction or a PCZT", () => {
    expect(readShareFragment("")).toBeNull();
    expect(readShareFragment("#hex=zz&net=main")).toBeNull();
    expect(readShareFragment(`#hex=${ironwoodTxid}`)).toBeNull();
    expect(readShareFragment("#pczt=00ff")).toBeNull();
  });
});
