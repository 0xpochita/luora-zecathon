import type { Check, TraceField, TraceKind, TraceNode } from "@contract/types";
import { nodeForCheck } from "./anatomy";
import { formatZec } from "./format";

export type TraceRowKind = TraceKind | "FEE";

export interface TraceRow {
  id: string;
  parentId: string | null;
  depth: number;
  kind: TraceRowKind;
  label: string;
  offset: number | null;
  length: number | null;
  fields: TraceField[];
  empty: boolean;
}

export type ExpandLevel = "collapsed" | "bundles" | "everything";

export const EXPAND_LEVELS: { value: ExpandLevel; label: string }[] = [
  { value: "collapsed", label: "Collapsed" },
  { value: "bundles", label: "Bundles" },
  { value: "everything", label: "Everything" },
];

export function traceRows(
  nodes: TraceNode[],
  inputValues: (number | null)[] | null,
  feeZat: number | null,
  inputsPending: boolean,
): TraceRow[] {
  const rows: TraceRow[] = nodes.map((node) => {
    const vin = /^vin-(\d+)$/.exec(node.id);
    const value = vin && inputValues ? inputValues[Number(vin[1])] : null;
    const fields =
      vin && value !== null && value !== undefined
        ? [{ name: "value", value: String(value), display: formatZec(value) }, ...node.fields]
        : node.fields;
    return {
      id: node.id,
      parentId: node.parentId,
      depth: node.depth,
      kind: node.kind,
      label: node.label,
      offset: node.offset,
      length: node.length,
      fields,
      empty: node.label === "empty",
    };
  });
  rows.push({
    id: "fee",
    parentId: "tx",
    depth: 1,
    kind: "FEE",
    label: feeZat !== null ? formatZec(feeZat) : inputsPending ? "fetching input values…" : "needs the spent output values",
    offset: null,
    length: null,
    fields: [
      {
        name: "formula",
        value: "transparent in − transparent out + Σ valueBalance",
        display: "Σ transparent in − out + valueBalance per pool",
      },
    ],
    empty: false,
  });
  return rows;
}

export function childCounts(rows: TraceRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.parentId) counts.set(row.parentId, (counts.get(row.parentId) ?? 0) + 1);
  return counts;
}

export function expandedFor(rows: TraceRow[], level: ExpandLevel): Set<string> {
  const counts = childCounts(rows);
  const parents = rows.filter((row) => counts.has(row.id));
  if (level === "collapsed") return new Set();
  if (level === "bundles") return new Set(parents.filter((row) => row.depth === 0).map((row) => row.id));
  return new Set(parents.map((row) => row.id));
}

function matches(row: TraceRow, query: string): boolean {
  const q = query.toLowerCase();
  if (row.kind.toLowerCase().includes(q) || row.label.toLowerCase().includes(q)) return true;
  return row.fields.some(
    (field) =>
      field.name.toLowerCase().startsWith(q) || field.value.toLowerCase().startsWith(q) || field.display.toLowerCase().startsWith(q),
  );
}

export function visibleRows(rows: TraceRow[], expanded: Set<string>, query: string): TraceRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const trimmed = query.trim();
  if (trimmed) {
    const keep = new Set<string>();
    for (const row of rows) {
      if (!matches(row, trimmed)) continue;
      let current: TraceRow | undefined = row;
      while (current && !keep.has(current.id)) {
        keep.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return rows.filter((row) => keep.has(row.id));
  }
  return rows.filter((row) => {
    let parent = row.parentId ? byId.get(row.parentId) : undefined;
    while (parent) {
      if (!expanded.has(parent.id)) return false;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return true;
  });
}

export function failingRows(checks: Check[] | null): Map<string, string[]> {
  const failing = new Map<string, string[]>();
  for (const check of checks ?? []) {
    if (check.status !== "fail") continue;
    const node = nodeForCheck(check);
    if (!node) continue;
    for (const id of node === "header" ? ["header", "locktime"] : [node]) {
      failing.set(id, [...(failing.get(id) ?? []), check.title]);
    }
  }
  return failing;
}
