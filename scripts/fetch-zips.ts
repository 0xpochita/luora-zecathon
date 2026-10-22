import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ZIPS = [203, 225, 229, 244, 257, 258, 317, 374, 2009];
const REPO = "zcash/zips";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/zips");
const UNDERLINE = /^([=\-~^"'`#*+])\1{2,}\s*$/;
const RST_LEVEL: Record<string, string> = { "=": "##", "-": "###", "~": "####", "^": "####" };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "luora-z-fetch-zips" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "luora-z-fetch-zips" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

export function rstToMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    if (UNDERLINE.test(line) && lines[index + 2] !== undefined && UNDERLINE.test(lines[index + 2]) && next.trim()) {
      out.push(`# ${next.trim()}`);
      index += 2;
      continue;
    }
    if (line.trim() && !UNDERLINE.test(line) && UNDERLINE.test(next) && next.trim().length >= line.trim().length) {
      out.push(`${RST_LEVEL[next.trim()[0]] ?? "####"} ${line.trim()}`);
      index += 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

async function main() {
  const head = await getJson<{ sha: string; commit: { committer: { date: string } } }>(`https://api.github.com/repos/${REPO}/commits/main`);
  const listing = await getJson<{ name: string }[]>(`https://api.github.com/repos/${REPO}/contents/zips?ref=${head.sha}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const index: { zip: number; url: string; source: string; commit: string; fetchedAt: string; markdown: string }[] = [];
  for (const zip of ZIPS) {
    const stem = `zip-${String(zip).padStart(4, "0")}`;
    const file = listing.find((entry) => entry.name === `${stem}.md` || entry.name === `${stem}.rst`);
    if (!file) throw new Error(`${stem} not found in ${REPO}@${head.sha}`);
    const raw = await getText(`https://raw.githubusercontent.com/${REPO}/${head.sha}/zips/${file.name}`);
    const body = file.name.endsWith(".rst") ? rstToMarkdown(raw) : raw.replace(/\r\n/g, "\n");
    const header = [
      "---",
      `zip: ${zip}`,
      `source: https://github.com/${REPO}/blob/${head.sha}/zips/${file.name}`,
      `commit: ${head.sha}`,
      `commitDate: ${head.commit.committer.date}`,
      `fetchedAt: ${fetchedAt}`,
      `url: https://zips.z.cash/${stem}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(path.join(OUT_DIR, `${stem}.md`), header + body);
    index.push({
      zip,
      url: `https://zips.z.cash/${stem}`,
      source: `https://github.com/${REPO}/blob/${head.sha}/zips/${file.name}`,
      commit: head.sha,
      fetchedAt,
      markdown: body,
    });
    console.log(`${stem}.md  ${file.name}  ${raw.length} bytes`);
  }
  writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));
  console.log(`zcash/zips@${head.sha}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
