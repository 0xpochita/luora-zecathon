import type { ZebraErrorEntry } from "@contract/types";

export const ZEBRA_STAGES: { id: ZebraErrorEntry["stage"]; label: string }[] = [
  { id: "rpc", label: "RPC" },
  { id: "mempool", label: "Mempool" },
  { id: "router", label: "Router" },
  { id: "block", label: "Block" },
  { id: "transaction", label: "Transaction verifier" },
  { id: "script", label: "Scripts" },
  { id: "proof-signature", label: "Proofs & signatures" },
  { id: "state", label: "State" },
];

export interface ZebraMatch {
  entry: ZebraErrorEntry;
  score: number;
  reason: "variant name" | "message template" | "shared words";
}

const PLACEHOLDER = /\{[^}]*\}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateRegExps(message: string): { pattern: RegExp; coverage: number }[] {
  const parts = message.split(PLACEHOLDER).map((part) => part.trim().toLowerCase());
  const totalLength = parts.join("").length;
  if (totalLength < 8) return [];
  const patterns: { pattern: RegExp; coverage: number }[] = [];
  for (let keep = parts.length; keep >= 1; keep -= 1) {
    const kept = parts.slice(0, keep);
    const keptLength = kept.join("").length;
    if (keptLength < 20 || keptLength / totalLength < 0.6) break;
    const source = kept.map((part) => escapeRegExp(part).replace(/\s+/g, "\\s*")).join(".*?");
    patterns.push({ pattern: new RegExp(source), coverage: keptLength / totalLength });
  }
  return patterns;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(PLACEHOLDER, " ")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

function camelWords(identifier: string): string {
  return identifier.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function matchZebraError(input: string, catalog: ZebraErrorEntry[], limit = 4): ZebraMatch[] {
  const query = input.trim();
  if (!query) return [];
  const lowered = query.toLowerCase();
  const queryWords = words(query);

  const scored = catalog.map((entry): ZebraMatch => {
    const shortVariant = entry.variant.split("::").pop() ?? entry.variant;
    if (query.includes(shortVariant) && shortVariant.length > 3) {
      return { entry, score: 100 + shortVariant.length / 100, reason: "variant name" };
    }
    const template = templateRegExps(entry.message).find(({ pattern }) => pattern.test(lowered));
    if (template) {
      return { entry, score: 60 + template.coverage * 20 + entry.message.length / 1000, reason: "message template" };
    }
    const entryWords = words(`${entry.message} ${camelWords(shortVariant)}`);
    let shared = 0;
    for (const word of queryWords) if (entryWords.has(word)) shared += 1;
    const overlap = entryWords.size ? shared / Math.max(entryWords.size, Math.min(queryWords.size, 12)) : 0;
    return { entry, score: overlap * 60, reason: "shared words" };
  });

  const ranked = scored.filter((match) => match.score >= 15).sort((left, right) => right.score - left.score);
  const best = ranked[0]?.score ?? 0;
  return ranked.filter((match) => match.score >= best * 0.5).slice(0, limit);
}
