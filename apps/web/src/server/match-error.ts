import type { ZebraErrorEntry } from "../../../../contract/types";

export interface ErrorMatch {
  entry: ZebraErrorEntry;
  score: number;
  how: "message" | "variant-name";
  wrapsAnotherMatch: boolean;
}

interface CompiledEntry {
  entry: ZebraErrorEntry;
  pattern: RegExp | null;
  literalLength: number;
  endsWithPlaceholder: boolean;
  variantName: string;
  typeName: string;
}

interface Hit {
  compiled: CompiledEntry;
  start: number;
  literalEnd: number;
  score: number;
  how: ErrorMatch["how"];
}

const PLACEHOLDER = /\{\{|\}\}|\{[^{}]*\}/g;
const MIN_LITERAL_CHARACTERS = 8;
const MIN_VARIANT_NAME_LENGTH = 8;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(entry: ZebraErrorEntry): CompiledEntry {
  const literals: string[] = [];
  let source = "";
  let lastIndex = 0;
  let endsWithPlaceholder = false;
  for (const match of entry.message.matchAll(PLACEHOLDER)) {
    const literal = entry.message.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    if (match[0] === "{{" || match[0] === "}}") {
      source += escapeRegExp(literal + match[0][0]);
      literals.push(literal + match[0][0]);
      endsWithPlaceholder = false;
      continue;
    }
    source += `${escapeRegExp(literal)}[\\s\\S]*?`;
    literals.push(literal);
    endsWithPlaceholder = true;
  }
  const tail = entry.message.slice(lastIndex);
  if (tail.length > 0) endsWithPlaceholder = false;
  source += escapeRegExp(tail);
  literals.push(tail);

  const literalLength = literals.join("").replace(/\s+/g, "").length;
  const segments = entry.variant.split("::");
  return {
    entry,
    pattern: literalLength >= MIN_LITERAL_CHARACTERS ? new RegExp(source.replace(/\s+/g, "\\s+"), "i") : null,
    literalLength,
    endsWithPlaceholder,
    variantName: segments.at(-1) ?? entry.variant,
    typeName: segments.at(-2) ?? "",
  };
}

const compiledCache = new WeakMap<ZebraErrorEntry[], CompiledEntry[]>();

function compiledCatalog(catalog: ZebraErrorEntry[]): CompiledEntry[] {
  let compiled = compiledCache.get(catalog);
  if (!compiled) {
    compiled = catalog.map(compile);
    compiledCache.set(catalog, compiled);
  }
  return compiled;
}

function findHits(text: string, catalog: CompiledEntry[]): Hit[] {
  const hits: Hit[] = [];
  for (const compiled of catalog) {
    const match = compiled.pattern?.exec(text);
    if (match) {
      hits.push({
        compiled,
        start: match.index,
        literalEnd: match.index + match[0].length,
        score: compiled.literalLength,
        how: "message",
      });
      continue;
    }
    if (compiled.variantName.length < MIN_VARIANT_NAME_LENGTH || compiled.variantName === compiled.typeName) continue;
    const namePattern = new RegExp(`\\b${escapeRegExp(compiled.variantName)}\\b`);
    const nameMatch = namePattern.exec(text);
    if (nameMatch) {
      const typeMentioned = compiled.typeName.length > 0 && text.includes(compiled.typeName);
      hits.push({
        compiled,
        start: nameMatch.index,
        literalEnd: nameMatch.index + nameMatch[0].length,
        score: compiled.variantName.length / 2 + (typeMentioned ? 10 : 0),
        how: "variant-name",
      });
    }
  }
  return hits;
}

export function matchError(pasted: string, catalog: ZebraErrorEntry[], limit = 5): ErrorMatch[] {
  const text = pasted.trim();
  if (text.length === 0) return [];
  const hits = findHits(text, compiledCatalog(catalog));
  const ranked = hits.map((hit) => {
    const wrappers = hits.filter(
      (other) =>
        other !== hit &&
        other.how === "message" &&
        other.compiled.endsWithPlaceholder &&
        hit.start >= other.literalEnd,
    );
    const wrapsAnotherMatch =
      hit.how === "message" &&
      hit.compiled.endsWithPlaceholder &&
      hits.some((other) => other !== hit && other.how === "message" && other.start >= hit.literalEnd);
    const namedByWrapper = wrappers.some((wrapper) => wrapper.compiled.variantName === hit.compiled.typeName);
    return { hit, wrapsAnotherMatch, namedByWrapper };
  });
  ranked.sort(
    (left, right) =>
      Number(left.wrapsAnotherMatch) - Number(right.wrapsAnotherMatch) ||
      Number(left.hit.how === "variant-name") - Number(right.hit.how === "variant-name") ||
      right.hit.score - left.hit.score ||
      Number(right.namedByWrapper) - Number(left.namedByWrapper) ||
      right.hit.start - left.hit.start,
  );
  return ranked.slice(0, limit).map(({ hit, wrapsAnotherMatch }) => ({
    entry: hit.compiled.entry,
    score: hit.score,
    how: hit.how,
    wrapsAnotherMatch,
  }));
}
