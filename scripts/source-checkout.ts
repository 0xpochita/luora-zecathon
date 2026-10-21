import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const SOURCE_ROOT = "/tmp/luora-z-src";

export interface Checkout {
  dir: string;
  ref: string;
  commit: string;
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function compareVersionTags(left: string, right: string): number {
  const parse = (tag: string) => {
    const [core, pre] = tag.replace(/^v/, "").split("-");
    return { parts: core.split(".").map(Number), pre: pre ?? null };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre.localeCompare(b.pre, "en", { numeric: true });
}

export function latestZebraTag(): string {
  const tags = git(["ls-remote", "--tags", "--refs", "https://github.com/ZcashFoundation/zebra"])
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter((tag): tag is string => Boolean(tag) && /^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag));
  return tags.sort(compareVersionTags).at(-1)!;
}

export function checkout(repoUrl: string, name: string, ref: string | null): Checkout {
  mkdirSync(SOURCE_ROOT, { recursive: true });
  const dir = path.join(SOURCE_ROOT, ref ? `${name}-${ref}` : name);
  if (!existsSync(path.join(dir, ".git"))) {
    const branchArgs = ref ? ["--branch", ref] : [];
    git(["clone", "--quiet", "--depth", "1", ...branchArgs, repoUrl, dir]);
  }
  return { dir, ref: ref ?? git(["rev-parse", "--abbrev-ref", "HEAD"], dir), commit: git(["rev-parse", "HEAD"], dir) };
}

export function zebraCheckout(): Checkout {
  const tag = process.env.ZEBRA_TAG || latestZebraTag();
  return checkout("https://github.com/ZcashFoundation/zebra", "zebra", tag);
}

export function librustzcashCheckout(): Checkout {
  return checkout("https://github.com/zcash/librustzcash", "librustzcash", null);
}

export function repoPath(...parts: string[]): string {
  return path.join(import.meta.dirname, "..", ...parts);
}
