import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Check, LuoraZCore } from "../../../../../contract/types";
import { claudeEvent, parseClaudeRequest, refuseClaude } from "./claude-guard";
import { buildPayload, NO_OPT_INS } from "./payload";
import { parseAnswer } from "./refs";
import { checkSubject, fieldPrivacy, traceRowSubject, type AskEnv } from "./subject";
import { pickExcerpts, splitSections, type ZipDocument } from "./zips";
import { traceRows, type TraceRow } from "../trace";

const docs: ZipDocument[] = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../data/zips/index.json"), "utf8"));

const wasmDir = path.join(__dirname, "../../../public/wasm");
const mainnet = JSON.parse(readFileSync(path.join(__dirname, "../../server/fixtures/mainnet-transactions.json"), "utf8"));
const TXID = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";
const HEIGHT = 3495600;
const HEX: string = mainnet.transactions[TXID].hex;
const PREV = "c533f8ac534d990811cbd5a171fcb9ab818e53d74cc9e3d540a518ba9e9aa42c";

let rows: TraceRow[];
let checks: Check[];
let env: AskEnv;
let address: string;
let script: string;
let nullifier: string;

beforeAll(async () => {
  const wasm = await import(path.join(wasmDir, "luora_z_core.js"));
  await wasm.default({ module_or_path: readFileSync(path.join(wasmDir, "luora_z_core_bg.wasm")) });
  const core = wasm as unknown as LuoraZCore;
  rows = traceRows(core.trace_tx(HEX, "main"), [509384, 595000], 15000, false);
  checks = core.check_tx(HEX, "main", HEIGHT, [509384, 595000]);
  env = { network: "main", height: HEIGHT, heightLabel: "when mined at 3,495,600", upgrade: "NU6.3", version: 6, txid: TXID, hex: HEX };
  const vout = rows.find((row) => row.id === "vout-0")!;
  address = vout.fields.find((field) => field.name === "address")!.value;
  script = vout.fields.find((field) => field.name === "scriptPubKey")!.value;
  nullifier = rows.find((row) => row.id === "ironwood-action-0")!.fields.find((field) => field.name === "nullifier")!.value;
});

const row = (id: string) => rows.find((item) => item.id === id)!;

describe("payload builder", () => {
  it("leaves out the txid, prevout txids, addresses, scripts and raw hex by default", () => {
    const subject = traceRowSubject(row("vout-0"), rows, checks, 6);
    const payload = buildPayload(subject, env, [], NO_OPT_INS, "Explain this part");
    const sent = payload.messages.map((message) => message.content).join("\n") + payload.system;
    expect(sent).not.toContain(TXID);
    expect(sent).not.toContain(address);
    expect(sent).not.toContain(script);
    expect(sent).not.toContain(HEX.slice(0, 40));
    expect(sent).toContain("value = 737554 (0.00737554 ZEC)");
    expect(sent).toContain("[address not sent]");
    expect(payload.withheld).toEqual(expect.arrayContaining(["txid", "addresses", "hex"]));

    const vin = buildPayload(traceRowSubject(row("vin-0"), rows, checks, 6), env, [], NO_OPT_INS, "Explain");
    expect(vin.context).not.toContain(PREV);
    expect(vin.context).toContain("scriptSig = 107 B");

    const action = buildPayload(traceRowSubject(row("ironwood-action-0"), rows, checks, 6), env, [], NO_OPT_INS, "Explain");
    expect(action.context).not.toContain(nullifier);
    expect(action.context).toContain("encCiphertext = 580 B, encrypted");
  });

  it("adds each item only when its box is ticked", () => {
    const subject = traceRowSubject(row("vout-0"), rows, checks, 6);
    const withTxid = buildPayload(subject, env, [], { ...NO_OPT_INS, txid: true }, "q").context;
    expect(withTxid).toContain(TXID);
    expect(withTxid).not.toContain(address);
    const withAddresses = buildPayload(subject, env, [], { ...NO_OPT_INS, addresses: true }, "q").context;
    expect(withAddresses).toContain(address);
    expect(withAddresses).not.toContain(TXID);
    const withHex = buildPayload(subject, env, [], { ...NO_OPT_INS, hex: true }, "q").context;
    expect(withHex).toContain(HEX.slice(0, 200));
    const withHashes = buildPayload(traceRowSubject(row("ironwood-action-0"), rows, checks, 6), env, [], { ...NO_OPT_INS, hashes: true }, "q").context;
    expect(withHashes).toContain(nullifier);
  });

  it("classifies hashes and sizes", () => {
    expect(fieldPrivacy("nullifier", nullifier, `${nullifier.slice(0, 8)}…`)).toBe("hash");
    expect(fieldPrivacy("encCiphertext", "00", "580 B, encrypted", true)).toBe("size");
    expect(fieldPrivacy("recipient", "not set", "not set")).toBe("public");
    expect(fieldPrivacy("consensusBranchId", "0x37a5165b", "0x37a5165b")).toBe("public");
  });

  it("carries the follow-up history after the context", () => {
    const subject = checkSubject(checks.find((check) => check.id === "branch-id")!, 6);
    const payload = buildPayload(subject, env, [], NO_OPT_INS, "and at NU7?", [
      { role: "user", content: "Why pass?" },
      { role: "assistant", content: "Because it matches." },
    ]);
    expect(payload.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(payload.messages[0].content).toContain("#branch-id PASS");
    expect(payload.messages[2].content).toBe("and at NU7?");
  });
});

describe("reference chips", () => {
  const known = { offsets: new Set([1706, 21]), checks: new Set(["branch-id", "zip317-fee"]) };

  it("turns known offsets, check ids and ZIP numbers into chips", () => {
    const segments = parseAnswer("The input at @21 and the header (@1706) fail #branch-id; see ZIP 244.", known);
    expect(segments.filter((segment) => segment.type !== "text")).toEqual([
      { type: "offset", offset: 21, text: "@21" },
      { type: "offset", offset: 1706, text: "@1706" },
      { type: "check", id: "branch-id", text: "#branch-id" },
      { type: "zip", zip: 244, text: "ZIP 244" },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe("The input at @21 and the header (@1706) fail #branch-id; see ZIP 244.");
  });

  it("keeps unknown references and look-alikes as plain text", () => {
    const segments = parseAnswer("email a@21 or @9999, #unknown-check, url/#branch-id", known);
    expect(segments).toEqual([{ type: "text", text: "email a@21 or @9999, #unknown-check, url/#branch-id" }]);
  });
});

describe("ZIP excerpt picker", () => {
  it("splits the vendored ZIPs into headed sections and drops change history", () => {
    const zip244 = docs.find((doc) => doc.zip === 244)!;
    const sections = splitSections(zip244);
    expect(sections.some((section) => section.heading.startsWith("T.1: header_digest"))).toBe(true);
    expect(sections.some((section) => /change history/i.test(section.trail.join(" ")))).toBe(false);
  });

  it("picks the section named by the check clause first", () => {
    const picked = pickExcerpts(docs, { zips: [317], clauses: ["Fee calculation"], keywords: ["fee", "logical actions"] });
    expect(picked[0].zip).toBe(317);
    expect(picked[0].heading).toBe("Fee calculation");
  });

  it("stays inside the requested ZIPs and the size budget", () => {
    const picked = pickExcerpts(docs, { zips: [225, 244], clauses: [], keywords: ["consensusBranchId", "header"] }, 3000);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((section) => section.zip === 225 || section.zip === 244)).toBe(true);
    expect(picked.reduce((sum, section) => sum + section.text.length, 0)).toBeLessThanOrEqual(3000 + 1500);
  });

  it("records the source commit of every vendored ZIP", () => {
    expect(docs.map((doc) => doc.zip).sort((a, b) => a - b)).toEqual([203, 225, 229, 244, 257, 258, 317, 374, 2009]);
    for (const doc of docs) expect(doc.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("/api/ai/claude guard", () => {
  const base = { method: "POST", host: "localhost:3035", origin: "http://localhost:3035", fetchSite: "same-origin", hosted: false };

  it("allows Luora's own page on loopback", () => {
    expect(refuseClaude(base)).toBeNull();
    expect(refuseClaude({ ...base, host: "127.0.0.1:3035", origin: "http://127.0.0.1:3035" })).toBeNull();
  });

  it("refuses a non-loopback host, even with a matching Origin", () => {
    expect(refuseClaude({ ...base, host: "192.168.1.20:3035", origin: "http://192.168.1.20:3035" })?.status).toBe(403);
    expect(refuseClaude({ ...base, host: "evil.example", origin: "http://evil.example" })?.status).toBe(403);
    expect(refuseClaude({ ...base, host: "localhost.evil.example:3035", origin: "http://localhost.evil.example:3035" })?.status).toBe(403);
  });

  it("refuses a foreign or missing Origin", () => {
    expect(refuseClaude({ ...base, origin: "https://evil.example" })?.status).toBe(403);
    expect(refuseClaude({ ...base, origin: "http://localhost:4000" })?.status).toBe(403);
    expect(refuseClaude({ ...base, origin: null })?.status).toBe(403);
    expect(refuseClaude({ ...base, fetchSite: "cross-site" })?.status).toBe(403);
  });

  it("answers 404 when hosted", () => {
    expect(refuseClaude({ ...base, hosted: true })?.status).toBe(404);
  });

  it("validates the body and reads Claude Code's stream", () => {
    expect(parseClaudeRequest({ messages: [{ role: "user", content: "hi" }] })).toEqual({ model: "", messages: [{ role: "user", content: "hi" }] });
    expect(typeof parseClaudeRequest({ model: "opus; rm -rf", messages: [{ role: "user", content: "hi" }] })).toBe("string");
    expect(typeof parseClaudeRequest({ messages: [{ role: "system", content: "x" }] })).toBe("string");
    expect(claudeEvent('{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}}')).toEqual({ text: "ok" });
    expect(claudeEvent('{"type":"result","is_error":true,"result":"Not logged in"}')).toEqual({ error: "Not logged in" });
    expect(claudeEvent('{"type":"system"}')).toBeNull();
  });
});

describe("check subject", () => {
  it("cites the check's ZIP clause", () => {
    const subject = checkSubject(checks.find((check) => check.id === "zip317-fee")!, 6);
    expect(subject.zips[0]).toEqual({ number: 317, clause: "Fee calculation" });
  });
});
