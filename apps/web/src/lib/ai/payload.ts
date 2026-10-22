import { NETWORK_LABEL } from "../format";
import type { AskEnv, AskField, AskSubject } from "./subject";
import type { ZipSection } from "./zips";

export interface OptIns {
  txid: boolean;
  hex: boolean;
  addresses: boolean;
  hashes: boolean;
}

export const NO_OPT_INS: OptIns = { txid: false, hex: false, addresses: false, hashes: false };

export const HEX_CHAR_LIMIT = 12_000;
const VALUE_CHAR_LIMIT = 160;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskPayload {
  system: string;
  context: string;
  question: string;
  messages: ChatTurn[];
  withheld: string[];
}

export const SYSTEM_PROMPT = [
  "You are the Ask AI helper inside Luora, a local-first inspector for Zcash transactions.",
  "Explain the selected part of a transaction, a consensus rule, a Zebra error or a PCZT in short plain words first, then define any jargon you use.",
  "Ground every protocol claim in the ZIP excerpts you are given and cite them as (ZIP 244 § T.1: header_digest). If the excerpts do not cover something, say so instead of guessing.",
  "Say clearly when something cannot be known from public data: shielded values, senders, recipients and memos are encrypted and stay unknown.",
  "Never guess or infer senders, recipients, amounts inside shielded notes, or who owns an address; never link transactions or addresses to each other or to people; refuse deanonymisation requests politely.",
  "Never write code or steps that attack nodes, wallets or users. Defensive inspection only.",
  "When you refer to a trace row, write its byte offset as @1706. When you refer to a check, write its id as #branch-id. Use only offsets and ids present in the context.",
  "Keep answers under 200 words unless the user asks for more. Use short paragraphs or a short list. No headings.",
].join("\n");

const SHIELDED_ADDRESS = /\b(?:u1|utest1|zs1|ztestsapling1|tex1|textest1)[02-9ac-hj-np-z]{20,}\b/g;
const TRANSPARENT_ADDRESS = /\bt[1-3mn][1-9A-HJ-NP-Za-km-z]{30,40}\b/g;
const HEX_ID = /\b[0-9a-fA-F]{64}\b/g;

export function redactText(text: string, optIns: OptIns): { text: string; withheld: string[] } {
  const withheld: string[] = [];
  let out = text;
  if (!optIns.addresses) {
    const before = out;
    out = out.replace(SHIELDED_ADDRESS, "[address not sent]").replace(TRANSPARENT_ADDRESS, "[address not sent]");
    if (out !== before) withheld.push("addresses");
  }
  if (!optIns.txid && !optIns.hashes) {
    const before = out;
    out = out.replace(HEX_ID, "[id or hash not sent]");
    if (out !== before) withheld.push("txid", "hashes");
  }
  return { text: out, withheld };
}

function clip(text: string, limit = VALUE_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text;
}

export function renderField(field: AskField, optIns: OptIns): { line: string; withheld: string | null } {
  switch (field.privacy) {
    case "txid":
      return optIns.txid
        ? { line: `${field.name} = ${field.value}`, withheld: null }
        : { line: `${field.name} = [transaction id not sent]`, withheld: "txid" };
    case "address":
      return optIns.addresses
        ? { line: `${field.name} = ${clip(field.value)}`, withheld: null }
        : { line: `${field.name} = [address not sent]`, withheld: "addresses" };
    case "hash":
      return optIns.hashes
        ? { line: `${field.name} = ${clip(field.value)}`, withheld: null }
        : { line: `${field.name} = [exact bytes not sent${field.display.includes("×") ? `; ${field.display}` : ""}]`, withheld: "hashes" };
    case "size":
      return { line: `${field.name} = ${field.display}`, withheld: null };
    default: {
      const line = field.display !== field.value ? `${field.name} = ${clip(field.value)} (${field.display})` : `${field.name} = ${clip(field.value)}`;
      const redacted = redactText(line, optIns);
      return { line: redacted.text, withheld: redacted.withheld[0] ?? null };
    }
  }
}

export function buildContext(subject: AskSubject, env: AskEnv, excerpts: ZipSection[], optIns: OptIns): { text: string; withheld: string[] } {
  const withheld = new Set<string>();
  const lines: string[] = [];
  lines.push(`Network: ${NETWORK_LABEL[env.network]}`);
  if (env.height !== null) lines.push(`Rules evaluated ${env.heightLabel || `at height ${env.height}`}${env.upgrade ? ` (${env.upgrade} rules)` : ""}`);
  if (env.version !== null) lines.push(`Transaction version: v${env.version}`);
  if (env.txid) {
    if (optIns.txid) lines.push(`Transaction id: ${env.txid}`);
    else withheld.add("txid");
  }
  lines.push("");
  lines.push(`Selected: ${subject.title}${subject.key.startsWith("@") && subject.offset !== null ? ` (${subject.key})` : ""}`);
  if (subject.parents.length) lines.push(`Inside: ${subject.parents.join(" > ")}`);
  if (subject.offset !== null && subject.length !== null) lines.push(`Bytes: offset ${subject.offset}, length ${subject.length}`);
  if (subject.fields.length) {
    lines.push("Fields:");
    for (const field of subject.fields) {
      const rendered = renderField(field, optIns);
      lines.push(`- ${rendered.line}`);
      if (rendered.withheld) withheld.add(rendered.withheld);
    }
  }
  const scrub = (text: string) => {
    const redacted = redactText(text, optIns);
    for (const item of redacted.withheld) withheld.add(item);
    return redacted.text;
  };
  for (const note of subject.notes) lines.push(`Note: ${scrub(note)}`);
  if (subject.checks.length) {
    lines.push("");
    lines.push("Related checks (computed by Luora in the browser with librustzcash):");
    for (const check of subject.checks) {
      const zip = check.zip ? ` [ZIP ${check.zip.number}${check.zip.clause ? ` § ${check.zip.clause}` : ""}]` : "";
      lines.push(`- #${check.id} ${check.status.toUpperCase()}: ${check.title}. ${scrub(check.detail)}${zip}${check.source ? ` (mirrors ${check.source})` : ""}`);
    }
  }
  if (excerpts.length) {
    lines.push("");
    lines.push("ZIP excerpts (zcash/zips, verbatim, may be cut):");
    for (const excerpt of excerpts) {
      lines.push(`--- ZIP ${excerpt.zip} § ${excerpt.trail.slice(1).join(" > ") || excerpt.heading} (${excerpt.url})`);
      lines.push(excerpt.text);
    }
  }
  if (env.hex) {
    if (optIns.hex) {
      lines.push("");
      lines.push(`Raw transaction hex${env.hex.length > HEX_CHAR_LIMIT ? ` (first ${HEX_CHAR_LIMIT} of ${env.hex.length} chars)` : ""}:`);
      lines.push(env.hex.slice(0, HEX_CHAR_LIMIT));
    } else withheld.add("hex");
  }
  return { text: lines.join("\n"), withheld: [...withheld] };
}

export function buildPayload(
  subject: AskSubject,
  env: AskEnv,
  excerpts: ZipSection[],
  optIns: OptIns,
  question: string,
  history: ChatTurn[] = [],
): AskPayload {
  const { text, withheld } = buildContext(subject, env, excerpts, optIns);
  const scrubbed = history.map((turn) => (turn.role === "assistant" ? { ...turn, content: redactText(turn.content, optIns).text } : turn));
  const first = `Context from Luora:\n${text}\n\nQuestion: ${question}`;
  const messages: ChatTurn[] =
    history.length === 0
      ? [{ role: "user", content: first }]
      : [{ role: "user", content: `Context from Luora:\n${text}\n\nQuestion: ${scrubbed[0].content}` }, ...scrubbed.slice(1), { role: "user", content: question }];
  return { system: SYSTEM_PROMPT, context: text, question, messages, withheld };
}
