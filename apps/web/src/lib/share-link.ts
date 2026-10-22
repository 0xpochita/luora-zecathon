import type { Network } from "@contract/types";
import { classifyInput } from "./input";

export const MAX_FRAGMENT_CHARS = 50_000;

export type ShareSource =
  | { kind: "txid"; txid: string; network: Network }
  | { kind: "hex"; data: string; network: Network }
  | { kind: "pczt"; data: string; network: Network }
  | { kind: "none" };

export type ShareLink =
  | { url: string; raw: "query" | "fragment" | "none" }
  | { url: string; raw: "too-big"; chars: number };

function parseNetwork(value: string | null): Network {
  return value === "test" ? "test" : "main";
}

export function buildShareLink(base: string, source: ShareSource, includeRaw: boolean): ShareLink {
  if (source.kind === "txid") return { url: `${base}?tx=${source.txid}&net=${source.network}`, raw: "query" };
  if (source.kind === "none" || !includeRaw) return { url: base, raw: "none" };
  const fragment = `${source.kind}=${encodeURIComponent(source.data)}&net=${source.network}`;
  if (fragment.length > MAX_FRAGMENT_CHARS) return { url: base, raw: "too-big", chars: fragment.length };
  return { url: `${base}#${fragment}`, raw: "fragment" };
}

export function readShareFragment(hash: string): { kind: "hex" | "pczt"; data: string; network: Network } | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text || text.length > MAX_FRAGMENT_CHARS) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return null;
  }
  const network = parseNetwork(params.get("net"));
  const hex = params.get("hex");
  if (hex !== null) {
    const kind = classifyInput(hex);
    return kind.kind === "hex" ? { kind: "hex", data: kind.hex, network } : null;
  }
  const pczt = params.get("pczt");
  if (pczt !== null) {
    const kind = classifyInput(pczt);
    return kind.kind === "pczt" ? { kind: "pczt", data: kind.data, network } : null;
  }
  return null;
}
