export type InputKind =
  | { kind: "empty" }
  | { kind: "txid"; txid: string }
  | { kind: "hex"; hex: string }
  | { kind: "pczt"; data: string }
  | { kind: "invalid"; reason: string };

const PCZT_MAGIC_HEX = "50435a54";
const PCZT_MAGIC_BASE64_PREFIX = "UENaV";

export function classifyInput(raw: string): InputKind {
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return { kind: "empty" };
  const lower = compact.toLowerCase();
  if (lower.startsWith(PCZT_MAGIC_HEX) && /^[0-9a-f]+$/.test(lower)) return { kind: "pczt", data: lower };
  if (compact.startsWith(PCZT_MAGIC_BASE64_PREFIX)) return { kind: "pczt", data: compact };
  if (/^[0-9a-f]+$/.test(lower)) {
    if (lower.length === 64) return { kind: "txid", txid: lower };
    if (lower.length % 2 !== 0) return { kind: "invalid", reason: "Hex has an odd number of characters." };
    return { kind: "hex", hex: lower };
  }
  return { kind: "invalid", reason: "Not hex, a 64-character txid, or a PCZT (hex or base64 starting with the PCZT magic)." };
}

export function isTxid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{64}$/.test(value);
}
