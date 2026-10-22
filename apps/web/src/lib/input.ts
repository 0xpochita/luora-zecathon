import { looksLikeNodeOutput } from "./stall";

export type InputKind =
  | { kind: "empty" }
  | { kind: "txid"; txid: string }
  | { kind: "block"; block: string }
  | { kind: "hex"; hex: string }
  | { kind: "pczt"; data: string }
  | { kind: "error"; text: string }
  | { kind: "stall"; text: string }
  | { kind: "invalid"; reason: string };

const PCZT_MAGIC_HEX = "50435a54";
const PCZT_MAGIC_BASE64_PREFIX = "UENaV";
const BLOCK_HEIGHT = /^[1-9]\d{0,9}$/;

export function classifyInput(raw: string): InputKind {
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return { kind: "empty" };
  if (looksLikeNodeOutput(raw)) return { kind: "stall", text: raw };
  const lower = compact.toLowerCase();
  const digits = compact.replace(/[,_]/g, "");
  if (/^[\d,_]+$/.test(compact) && BLOCK_HEIGHT.test(digits)) return { kind: "block", block: digits };
  if (lower.startsWith(PCZT_MAGIC_HEX) && /^[0-9a-f]+$/.test(lower)) return { kind: "pczt", data: lower };
  if (compact.startsWith(PCZT_MAGIC_BASE64_PREFIX)) return { kind: "pczt", data: compact };
  if (/^[0-9a-f]+$/.test(lower)) {
    if (lower.length === 64) return { kind: "txid", txid: lower };
    if (lower.length % 2 !== 0) return { kind: "invalid", reason: "Hex has an odd number of characters." };
    return { kind: "hex", hex: lower };
  }
  if (/[g-z\s:]/i.test(raw.trim())) return { kind: "error", text: raw.trim() };
  return { kind: "invalid", reason: "Not hex, a 64-character txid or block hash, a block height, a PCZT or a Zebra error message." };
}

export function isTxid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{64}$/.test(value);
}

export function isBlockRef(value: string | null | undefined): value is string {
  return !!value && (/^[0-9a-f]{64}$/.test(value) || BLOCK_HEIGHT.test(value));
}
