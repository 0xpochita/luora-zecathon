export interface ZipDocument {
  zip: number;
  url: string;
  source: string;
  commit: string;
  fetchedAt: string;
  markdown: string;
}

export interface ZipSection {
  zip: number;
  heading: string;
  trail: string[];
  text: string;
  url: string;
}

export interface ZipQuery {
  zips: number[];
  clauses: string[];
  keywords: string[];
}

const SKIPPED_HEADINGS = /^(change history|acknowledg|endorsements|references|copyright|license|terminology)/i;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "are", "not", "its", "per", "zip", "rule", "rules", "check"]);

export const SECTION_CHAR_LIMIT = 1400;
export const EXCERPT_BUDGET = 4200;

export function splitSections(doc: ZipDocument): ZipSection[] {
  const sections: ZipSection[] = [];
  const trail: string[] = [];
  let current: { heading: string; trail: string[]; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) sections.push({ zip: doc.zip, heading: current.heading, trail: current.trail, text, url: doc.url });
  };
  for (const line of doc.markdown.split("\n")) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      const heading = match[2].replace(/[`*]/g, "").trim();
      trail.length = Math.max(0, level - 1);
      trail[level - 1] = heading;
      current = { heading, trail: trail.filter(Boolean), lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return sections.filter((section) => !section.trail.some((part) => SKIPPED_HEADINGS.test(part)));
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function splitCamel(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function scoreSection(section: ZipSection, clauseWords: string[][], keywords: string[]): number {
  const own = new Set(words(splitCamel(section.heading)));
  const headingSet = new Set(words(splitCamel(section.trail.join(" "))));
  const bodyText = section.text.toLowerCase();
  let score = 0;
  for (const clause of clauseWords) {
    if (clause.length === 0) continue;
    const ownHits = clause.filter((word) => own.has(word)).length;
    const trailHits = clause.filter((word) => headingSet.has(word)).length;
    score += (ownHits / clause.length) * 40 + (trailHits / clause.length) * 10;
  }
  for (const keyword of keywords) {
    if (headingSet.has(keyword)) score += 6;
    if (bodyText.includes(keyword)) score += 1;
  }
  if (/specification|consensus|fee calculation/i.test(section.trail.join(" "))) score += 2;
  return score;
}

export function clipText(text: string, limit = SECTION_CHAR_LIMIT): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". "));
  return `${cut.slice(0, end > limit * 0.5 ? end + 1 : limit).trimEnd()} …`;
}

export function pickExcerpts(docs: ZipDocument[], query: ZipQuery, budget = EXCERPT_BUDGET): ZipSection[] {
  const wanted = [...new Set(query.zips)];
  const clauseWords = query.clauses.map((clause) => words(splitCamel(clause)));
  const keywords = [...new Set(query.keywords.flatMap((keyword) => words(splitCamel(keyword))))];
  const picked: ZipSection[] = [];
  let used = 0;
  const perZip = wanted.map((zip) => {
    const doc = docs.find((item) => item.zip === zip);
    if (!doc) return [];
    return splitSections(doc)
      .map((section) => ({ section, score: scoreSection(section, clauseWords, keywords) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
  });
  for (let round = 0; round < 3; round += 1) {
    for (const ranked of perZip) {
      const next = ranked[round];
      if (!next) continue;
      const text = clipText(next.section.text);
      if (used + text.length > budget && picked.length > 0) continue;
      picked.push({ ...next.section, text });
      used += text.length;
    }
  }
  return picked;
}

export async function loadZipDocuments(): Promise<ZipDocument[]> {
  const module = await import("../../../../../data/zips/index.json");
  return module.default as ZipDocument[];
}
