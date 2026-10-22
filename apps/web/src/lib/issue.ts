import type { Check, Network, PcztView, ZebraErrorEntry } from "@contract/types";
import { formatInt, NETWORK_LABEL, shortHash, zipUrl } from "./format";

export const LIBRUSTZCASH_REV = "8672a4b2d60f432664780e6a4e85f49a36805a2a";
export const ZEBRA_REPO = "https://github.com/ZcashFoundation/zebra";

export interface IssueVersions {
  librustzcash: string;
  zebraCatalog: string | null;
}

export interface IssueEnv {
  network: Network;
  link: string;
  versions: IssueVersions;
}

export interface IssueZebraMatch {
  entry: ZebraErrorEntry;
  reason: string;
}

export type IssueSubject =
  | {
      kind: "tx";
      txid: string;
      source: "mined" | "mempool" | "pasted" | "side-chain";
      minedHeight: number | null;
      checkedAt: number | null;
      heightLabel: string;
      verdict: string;
      checks: Check[];
      mempool: string[];
    }
  | { kind: "error"; text: string; matches: IssueZebraMatch[]; checkedAt: number | null }
  | { kind: "pczt"; view: PcztView; checkedAt: number | null };

const STATUS_WORD: Record<Check["status"], string> = { fail: "fail", warn: "warn", pass: "pass", na: "n/a" };

function zebraRef(zebraVersion: string): string {
  const commit = zebraVersion.match(/\(([0-9a-f]{7,40})\)/);
  return commit ? commit[1] : zebraVersion.split(/\s+/)[0];
}

export function zebraSourceUrl(entry: ZebraErrorEntry): string {
  const file = entry.file.startsWith(`${entry.crate}/`) ? entry.file : `${entry.crate}/${entry.file}`;
  return `${ZEBRA_REPO}/blob/${zebraRef(entry.zebraVersion)}/${file}#L${entry.line}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

function zipLink(zip: Check["zip"]): string {
  if (!zip) return "";
  return ` · [ZIP ${zip.number}${zip.clause ? `, ${zip.clause}` : ""}](${zip.url || zipUrl(zip.number)})`;
}

function checkLine(check: Check): string {
  return `- **${STATUS_WORD[check.status]}** · ${check.title}: ${oneLine(check.detail)}${zipLink(check.zip)}${check.source ? ` · \`${oneLine(check.source)}\`` : ""}`;
}

function rulesSection(checks: Check[], heightText: string): string[] {
  const order = { fail: 0, warn: 1, pass: 2, na: 3 } as const;
  const flagged = checks.filter((check) => check.status === "fail" || check.status === "warn").sort((a, b) => order[a.status] - order[b.status]);
  const counted = checks.filter((check) => check.status !== "na");
  const passed = counted.filter((check) => check.status === "pass").length;
  const lines = [`### Rules ${heightText}`, "", `${passed} of ${counted.length} rules pass.`];
  if (flagged.length > 0) lines.push("", ...flagged.map(checkLine));
  return lines;
}

function versionLines(versions: IssueVersions): string[] {
  return [
    "### Decoder",
    "",
    `- librustzcash \`${versions.librustzcash.slice(0, 8)}\` ([${versions.librustzcash}](https://github.com/zcash/librustzcash/tree/${versions.librustzcash})), compiled to WebAssembly, decoded in the browser`,
    `- Zebra error catalog: ${versions.zebraCatalog ? `Zebra ${versions.zebraCatalog}` : "not loaded"}`,
  ];
}

function heightOf(checkedAt: number | null): string {
  return checkedAt === null ? "not available" : formatInt(checkedAt);
}

export function issueTitle(subject: IssueSubject, network: Network): string {
  const net = NETWORK_LABEL[network];
  if (subject.kind === "tx") {
    const failing = subject.checks.filter((check) => check.status === "fail");
    const warning = subject.checks.filter((check) => check.status === "warn");
    const where = subject.checkedAt !== null ? ` at height ${formatInt(subject.checkedAt)}` : "";
    const id = shortHash(subject.txid, 8, 4);
    const state = subject.source === "mempool" ? " stuck in the mempool" : "";
    if (failing.length > 0) return `${net} transaction ${id}${state} fails ${failing.map((check) => check.title).join(", ")}${where}`;
    if (warning.length > 0) return `${net} transaction ${id}${state}: ${warning.map((check) => check.title).join(", ")} warns${where}`;
    return `${net} transaction ${id}${state} passes all rules${where}`;
  }
  if (subject.kind === "error") {
    const top = subject.matches[0];
    return top ? `Zebra rejected a transaction: ${top.entry.variant}` : `Zebra error with no match in the catalog: ${oneLine(subject.text).slice(0, 80)}`;
  }
  const done = subject.view.roles.filter((role) => role.done).length;
  const flagged = subject.view.checks.filter((check) => check.status === "fail" || check.status === "warn");
  return `${net} PCZT: ${done} of ${subject.view.roles.length} roles done${flagged.length > 0 ? `, ${flagged.map((check) => check.title).join(", ")} ${flagged.some((check) => check.status === "fail") ? "fails" : "warns"}` : ""}`;
}

export function buildIssueMarkdown(subject: IssueSubject, env: IssueEnv): string {
  const lines: string[] = [`## ${issueTitle(subject, env.network)}`, ""];
  const facts: [string, string][] = [["Network", NETWORK_LABEL[env.network]]];

  if (subject.kind === "tx") {
    const txLine =
      subject.source === "pasted"
        ? `unbroadcast hex, not included (txid \`${subject.txid}\` computed in the browser)`
        : `\`${subject.txid}\``;
    const state =
      subject.source === "mined"
        ? `mined at ${heightOf(subject.minedHeight)}`
        : subject.source === "mempool"
          ? "in the mempool, not mined yet"
          : subject.source === "side-chain"
            ? "known to the indexer, not in the main chain"
            : "pasted, not looked up";
    facts.push(["Rules checked", subject.checkedAt === null || !subject.heightLabel ? "not available" : subject.heightLabel]);
    facts.push(["Transaction", txLine]);
    facts.push(["State", state]);
    lines.push("| | |", "|---|---|", ...facts.map(([key, value]) => `| ${key} | ${value} |`), "");
    lines.push(`**Verdict:** ${oneLine(subject.verdict)}`, "");
    if (subject.mempool.length > 0) lines.push("### Mempool", "", ...subject.mempool.map((line) => `- ${line}`), "");
    lines.push(...rulesSection(subject.checks, subject.heightLabel), "");
  }

  if (subject.kind === "error") {
    facts.push(["Tip when reported", heightOf(subject.checkedAt)]);
    lines.push("| | |", "|---|---|", ...facts.map(([key, value]) => `| ${key} | ${value} |`), "");
    lines.push("### Error as reported", "", fence(subject.text.trim()), "");
    const top = subject.matches[0];
    if (top) {
      const { entry } = top;
      lines.push(
        "### Matched Zebra variant",
        "",
        `- **${entry.variant}**, matched by ${top.reason}`,
        `- Message: \`${oneLine(entry.message)}\``,
        `- Stage: ${entry.stage}`,
        `- Source: [${entry.file}:${entry.line}](${zebraSourceUrl(entry)}) (Zebra ${entry.zebraVersion})`,
      );
      if (entry.zips.length > 0) lines.push(`- ZIPs: ${entry.zips.map((zip) => `[ZIP ${zip}](${zipUrl(zip)})`).join(", ")}`);
      lines.push("", oneLine(entry.plain), "");
      const others = subject.matches.slice(1, 4);
      if (others.length > 0) lines.push(`Other candidates: ${others.map((match) => `\`${match.entry.variant}\``).join(", ")}.`, "");
    } else {
      lines.push("No variant in the Zebra catalog matches this text.", "");
    }
  }

  if (subject.kind === "pczt") {
    const { view } = subject;
    const done = view.roles.filter((role) => role.done).map((role) => role.name);
    const open = view.roles.filter((role) => !role.done).map((role) => role.name);
    facts.push(["Tip when reported", heightOf(subject.checkedAt)]);
    facts.push(["Transaction", "PCZT, not included"]);
    lines.push("| | |", "|---|---|", ...facts.map(([key, value]) => `| ${key} | ${value} |`), "");
    lines.push(
      "### PCZT roles (ZIP 374)",
      "",
      `- Done (${done.length} of ${view.roles.length}): ${done.join(", ") || "none"}`,
      `- Not done: ${open.join(", ") || "none"}`,
      "",
    );
    const pools = new Map<string, { count: number; proofs: number; signatures: number }>();
    for (const action of view.actions) {
      const entry = pools.get(action.pool) ?? { count: 0, proofs: 0, signatures: 0 };
      entry.count += 1;
      entry.proofs += action.proof ? 1 : 0;
      entry.signatures += action.signature ? 1 : 0;
      pools.set(action.pool, entry);
    }
    if (pools.size > 0) {
      lines.push(
        "| Pool | Actions | With proof | With signature |",
        "|---|---|---|---|",
        ...[...pools].map(([pool, entry]) => `| ${pool} | ${entry.count} | ${entry.proofs} | ${entry.signatures} |`),
        "",
      );
    }
    lines.push(...rulesSection(view.checks, "(signer checks)"), "");
  }

  lines.push(...versionLines(env.versions), "");
  lines.push(`[Open in Luora](${env.link})`);
  return lines.join("\n");
}
