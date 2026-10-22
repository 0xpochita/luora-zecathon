import type { Check, Zip318View } from "@contract/types";

export type MigrationTone = "ok" | "bad" | "neutral";

export interface MigrationVerdict {
  label: "Blends in" | "Fingerprintable" | "Unknown";
  tone: MigrationTone;
  shape: string;
}

export const CONFORMANCE_NOTE =
  "This names a conformance class, never a provenance: matching the shape puts a transaction in the crowd of ZIP 318 migrations, it never says whose migration it is.";

export function migrationVerdict(view: Zip318View): MigrationVerdict | null {
  switch (view.classification) {
    case "transfer":
      return { label: "Blends in", tone: "ok", shape: "Matches the ZIP 318 transfer shape (Orchard to Ironwood crossing)." };
    case "preparation":
      return { label: "Blends in", tone: "ok", shape: "Matches the ZIP 318 note preparation shape." };
    case "nonconforming":
      return { label: "Fingerprintable", tone: "bad", shape: "Moves Orchard funds but breaks the ZIP 318 shape, so it stands apart from migration transactions." };
    case "unknown":
      return { label: "Unknown", tone: "neutral", shape: "No label yet: the public data fits a ZIP 318 shape, but deciding needs evidence only the wallet has." };
    default:
      return null;
  }
}

export function reasonTone(ok: boolean | null): MigrationTone {
  return ok === null ? "neutral" : ok ? "ok" : "bad";
}

export function migrationCheck(view: Zip318View): Check | null {
  const verdict = migrationVerdict(view);
  if (!verdict) return null;
  return {
    id: "zip318-migration",
    title: `ZIP 318 migration: ${verdict.label}`,
    status: verdict.tone === "ok" ? "pass" : verdict.tone === "bad" ? "fail" : "na",
    detail: [verdict.shape, ...view.reasons.map((reason) => `${reason.field}: ${reason.detail}`)].join(" "),
    zip: { number: 318, clause: "Canonical migration transaction structure", url: "https://zips.z.cash/zip-0318" },
    source: "librustzcash 8672a4b2 components/zcash_protocol/src/zip318.rs:831 classify",
  };
}
