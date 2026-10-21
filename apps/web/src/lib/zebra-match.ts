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

function templateRegExp(message: string): RegExp | null {
  const literalParts = message.split(PLACEHOLDER).map((part) => escapeRegExp(part.trim().toLowerCase()));
  const literalLength = literalParts.join("").length;
  if (literalLength < 8) return null;
  return new RegExp(literalParts.join(".*?").replace(/\s+/g, "\\s*"));
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

export function matchZebraError(input: string, catalog: ZebraErrorEntry[], limit = 5): ZebraMatch[] {
  const query = input.trim();
  if (!query) return [];
  const lowered = query.toLowerCase();
  const queryWords = words(query);

  const scored = catalog.map((entry): ZebraMatch => {
    const shortVariant = entry.variant.split("::").pop() ?? entry.variant;
    if (query.includes(shortVariant) && shortVariant.length > 3) {
      return { entry, score: 100 + shortVariant.length / 100, reason: "variant name" };
    }
    const template = templateRegExp(entry.message);
    if (template && template.test(lowered)) {
      return { entry, score: 80 + entry.message.length / 1000, reason: "message template" };
    }
    const entryWords = words(`${entry.message} ${camelWords(shortVariant)}`);
    let shared = 0;
    for (const word of queryWords) if (entryWords.has(word)) shared += 1;
    const overlap = entryWords.size ? shared / Math.max(entryWords.size, Math.min(queryWords.size, 12)) : 0;
    return { entry, score: overlap * 60, reason: "shared words" };
  });

  return scored
    .filter((match) => match.score >= 15)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
