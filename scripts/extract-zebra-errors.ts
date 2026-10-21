import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ZebraErrorEntry } from "../contract/types";
import { repoPath, zebraCheckout } from "./source-checkout";

type Stage = ZebraErrorEntry["stage"];

interface RawError {
  type: string;
  variant: string;
  line: number;
  message: string | null;
  transparent: boolean;
  source: string | null;
}

interface Notes {
  excludedTypes: Record<string, string>;
  stageByType: Record<string, Stage>;
  stageByVariant: Record<string, { stage: Stage; raisedAt?: string }>;
  notes: Record<string, { zips: number[]; plain: string }>;
}

const SCANNED_DIRECTORIES = [
  "zebra-chain/src",
  "zebra-consensus/src",
  "zebra-state/src",
  "zebra-script/src",
  "zebra-rpc/src",
  "zebra-node-services/src",
  "zebrad/src/components",
];

const TEST_PATH = /(^|\/)(tests?|arbitrary|prop)(\/|\.rs$)|_tests?\.rs$|\/tests\.rs$/;

const STAGE_TEXT: Record<Stage, string> = {
  router: "block routing, where Zebra picks checkpoint or full verification",
  block: "block verification",
  transaction: "transaction verification",
  script: "transparent script verification",
  "proof-signature": "proof and signature verification",
  state: "contextual validation against the chain state",
  mempool: "mempool admission",
  rpc: "the RPC layer",
};

function rustFiles(root: string, directory: string): string[] {
  const absolute = path.join(root, directory);
  return readdirSync(absolute).flatMap((name) => {
    const relative = path.join(directory, name);
    if (statSync(path.join(root, relative)).isDirectory()) return rustFiles(root, relative);
    return name.endsWith(".rs") ? [relative] : [];
  });
}

function definesErrors(source: string): boolean {
  return source.includes("#[error(") || /#\[derive\([^)]*\bError\b[^)]*\)\]/.test(source);
}

function crateName(file: string): string {
  return file.split("/")[0].replaceAll("-", "_");
}

function moduleQualifier(file: string): string {
  const [, ...rest] = file.split("/src/");
  const modulePath = rest.join("/src/").replace(/\.rs$/, "").split("/").filter((part) => part !== "components");
  const trimmed = modulePath.at(-1) === "error" || modulePath.at(-1) === "lib" ? modulePath.slice(0, -1) : modulePath;
  return trimmed.length === 0 ? crateName(file) : trimmed.join("::");
}

function countErrorAttributes(source: string): number {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && line.includes("#[error("))
    .length;
}

function main() {
  const zebra = zebraCheckout();
  const notes: Notes = JSON.parse(readFileSync(repoPath("scripts", "zebra-error-notes.json"), "utf8"));
  const extractorManifest = repoPath("scripts", "zebra-error-extractor", "Cargo.toml");
  execFileSync("cargo", ["build", "--release", "--quiet", "--manifest-path", extractorManifest], { stdio: "inherit" });
  const extractor = repoPath("scripts", "zebra-error-extractor", "target", "release", "zebra-error-extractor");

  const files = SCANNED_DIRECTORIES.flatMap((directory) => rustFiles(zebra.dir, directory))
    .filter((file) => !TEST_PATH.test(file))
    .filter((file) => definesErrors(readFileSync(path.join(zebra.dir, file), "utf8")))
    .sort();

  const extracted: { file: string; errors: RawError[] }[] = JSON.parse(
    execFileSync(extractor, files, { cwd: zebra.dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  );

  const problems: string[] = [];
  for (const { file, errors } of extracted) {
    const attributes = countErrorAttributes(readFileSync(path.join(zebra.dir, file), "utf8"));
    const withAttribute = errors.filter((error) => error.message !== null || error.transparent).length;
    if (attributes > withAttribute) problems.push(`${file}: ${attributes} #[error] attributes but ${withAttribute} parsed`);
  }

  const kept = extracted.flatMap(({ file, errors }) =>
    errors
      .filter((error) => !(`${file}::${error.type}` in notes.excludedTypes))
      .map((error) => ({ file, error })),
  );

  const typeFiles = new Map<string, Set<string>>();
  for (const { file, error } of kept) {
    typeFiles.set(error.type, (typeFiles.get(error.type) ?? new Set()).add(file));
  }

  const usedNotes = new Set<string>();
  const usedStageOverrides = new Set<string>();
  const version = `${zebra.ref} (${zebra.commit.slice(0, 10)})`;

  const entries: ZebraErrorEntry[] = kept.map(({ file, error }) => {
    const ambiguous = (typeFiles.get(error.type)?.size ?? 0) > 1;
    const typeName = ambiguous ? `${moduleQualifier(file)}::${error.type}` : error.type;
    const variant = error.type === error.variant ? typeName : `${typeName}::${error.variant}`;

    const override = notes.stageByVariant[variant];
    if (override) usedStageOverrides.add(variant);
    const stage = override?.stage ?? notes.stageByType[`${file}::${error.type}`];
    if (!stage) problems.push(`no stage for ${file}::${error.type}`);

    const message = error.transparent ? "{0}" : (error.message ?? "");
    if (!error.transparent && error.message === null) problems.push(`no message for ${variant} at ${file}:${error.line}`);

    const note = notes.notes[variant];
    if (note) usedNotes.add(variant);
    const fallbackPlain = error.transparent
      ? `Zebra shows the wrapped ${error.source ?? "inner"} error's own message here; it is raised during ${STAGE_TEXT[stage]}.`
      : `Zebra reports "${message}" during ${STAGE_TEXT[stage]}.`;

    return {
      variant,
      crate: file.split("/")[0],
      file,
      line: error.line,
      message,
      stage,
      zips: note?.zips ?? [],
      plain: note?.plain ?? fallbackPlain,
      zebraVersion: version,
    };
  });

  for (const key of Object.keys(notes.notes)) if (!usedNotes.has(key)) problems.push(`note for unknown variant ${key}`);
  for (const key of Object.keys(notes.stageByVariant)) if (!usedStageOverrides.has(key)) problems.push(`stage override for unknown variant ${key}`);
  const names = entries.map((entry) => entry.variant);
  for (const name of names) if (names.indexOf(name) !== names.lastIndexOf(name)) problems.push(`duplicate variant name ${name}`);

  if (problems.length > 0) {
    console.error([...new Set(problems)].join("\n"));
    process.exit(1);
  }

  writeFileSync(repoPath("data", "zebra-errors.json"), `${JSON.stringify(entries, null, 2)}\n`);
  const excludedCount = extracted.flatMap(({ file, errors }) => errors.filter((error) => `${file}::${error.type}` in notes.excludedTypes)).length;
  console.log(
    `wrote ${entries.length} variants (${usedNotes.size} with written explanations, ${excludedCount} excluded non-validation variants) from zebra ${version}, ${files.length} files`,
  );
}

main();
