"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { childCounts, EXPAND_LEVELS, expandedFor, visibleRows, type ExpandLevel, type TraceRow, type TraceRowKind } from "@/lib/trace";
import { formatInt } from "@/lib/format";
import { delayStyle } from "./anatomy-view";
import { AskButton } from "./ask-ai";
import { ExpandableCard } from "./expandable-card";
import { CopyButton, Dot, Hint, Inner, Input, Select } from "./ui";

type BadgeTone = "neutral" | "blue" | "green" | "yellow" | "red";

const KIND_TONE: Record<TraceRowKind, BadgeTone> = {
  TX: "neutral",
  HEADER: "neutral",
  TRANSPARENT: "neutral",
  VIN: "blue",
  VOUT: "blue",
  SAPLING: "neutral",
  SPEND: "green",
  OUTPUT: "green",
  BALANCE: "neutral",
  PROOF: "neutral",
  "AUTH SIG": "neutral",
  "BINDING SIG": "neutral",
  JOINSPLITS: "neutral",
  ORCHARD: "neutral",
  IRONWOOD: "neutral",
  ACTION: "green",
  FEE: "yellow",
};

const BADGE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-white/15 text-muted",
  blue: "border-blue/45 text-blue",
  green: "border-green/45 text-green",
  yellow: "border-yellow/45 text-yellow",
  red: "border-red/50 text-red",
};

export function KindBadge({ depth, kind, failing }: { depth: number; kind: TraceRowKind; failing: boolean }) {
  return (
    <span
      className={`inline-flex h-[22px] flex-none items-center rounded-[6px] border px-1.5 font-mono text-[11px] leading-none whitespace-nowrap ${
        BADGE_CLASS[failing ? "red" : KIND_TONE[kind]]
      }`}
    >
      {depth} → {kind}
    </span>
  );
}

function ZecText({ text }: { text: string }) {
  if (!text.endsWith(" ZEC")) return <>{text}</>;
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      <Image src="/brand/zec.png" alt="" width={14} height={14} className="inline-block size-3.5 shrink-0" />
    </span>
  );
}

export function FieldInline({ name, display, encrypted }: { name: string; display: string; encrypted?: boolean }) {
  return (
    <span className="break-all sm:break-normal sm:whitespace-nowrap">
      <span className="text-muted">{name}=</span>
      <span className={encrypted ? "text-dim italic" : "text-text"}><ZecText text={display} /></span>
    </span>
  );
}

function TraceRowView({
  row,
  index,
  hasChildren,
  open,
  active,
  failing,
  showOffsets,
  showSizes,
  onToggle,
  onActivate,
  onOpen,
  onAsk,
}: {
  row: TraceRow;
  index: number;
  hasChildren: boolean;
  open: boolean;
  active: boolean;
  failing: string[] | undefined;
  showOffsets: boolean;
  showSizes: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onOpen: () => void;
  onAsk?: () => void;
}) {
  return (
    <div
      id={`trace-row-${row.id}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={active}
      onClick={() => {
        onActivate();
        onOpen();
      }}
      title={failing ? `Failing check: ${failing.join(", ")}` : undefined}
      style={delayStyle(Math.min(index * 18, 360))}
      className={`node-in group flex min-h-8 cursor-pointer items-start gap-2 rounded-chip px-2 py-1 sm:min-w-max sm:items-center ${
        active ? "bg-hover shadow-[inset_2px_0_0_var(--fg)]" : "hover:bg-white/[.035]"
      } ${row.empty ? "opacity-50" : ""}`}
    >
      {showOffsets && (
        <span className="w-9 flex-none pt-0.5 text-right font-mono sm:w-12 text-[11.5px] text-muted tabular-nums sm:pt-0" title={row.offset !== null ? `byte offset ${row.offset}` : "computed, not in the bytes"}>
          {row.offset !== null ? row.offset : ""}
        </span>
      )}
      {showSizes && (
        <span className="hidden w-16 flex-none text-right font-mono text-[11.5px] text-dim tabular-nums sm:inline" title="length in bytes">
          {row.length !== null ? `${formatInt(row.length)} B` : ""}
        </span>
      )}
      <span
        aria-hidden
        className="trace-guides w-[calc(var(--depth)*10px)] flex-none self-stretch sm:w-[calc(var(--depth)*16px)]"
        style={{ "--depth": row.depth } as CSSProperties}
      />
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          aria-label={open ? "Collapse" : "Expand"}
          className="mt-[3px] grid size-4 flex-none place-items-center rounded-[4px] border border-white/20 font-mono text-[11px] leading-none text-muted hover:border-white/40 hover:text-fg sm:mt-0"
        >
          {open ? "−" : "+"}
        </button>
      ) : (
        <span className="w-4 flex-none" />
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] sm:flex-nowrap">
        <KindBadge depth={row.depth} kind={row.kind} failing={!!failing} />
        <span title={row.why ?? undefined} className={`min-w-0 break-words sm:whitespace-nowrap ${row.depth === 0 ? "font-medium text-fg" : "text-fg"}`}><ZecText text={row.label} /></span>
        {failing && <Dot tone="bad" />}
        {row.fields.length > 0 && (
          <span className="flex basis-full flex-wrap gap-x-2.5 gap-y-0.5 text-[12px] sm:basis-auto sm:flex-nowrap">
            <span className="hidden text-muted sm:inline">(</span>
            {row.fields.map((field) => (
              <FieldInline key={field.name} name={field.name} display={field.display} encrypted={field.encrypted} />
            ))}
            <span className="hidden text-muted sm:inline">)</span>
          </span>
        )}
      </span>
      {onAsk && (
        <AskButton
          onAsk={onAsk}
          label={`Ask AI about ${row.kind} ${row.label}`}
          className={`-my-0.5 sm:sticky sm:right-0 ${active ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
        />
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="inline-flex h-8 items-center gap-2 rounded-tile bg-raised px-2.5 text-[12.5px] text-text">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-[#f4f4f5]" />
      {label}
    </label>
  );
}

export function TraceView({
  rows,
  failing,
  activeId,
  onActiveChange,
  onOpen,
  onAsk,
  aside,
}: {
  rows: TraceRow[];
  failing: Map<string, string[]>;
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onOpen: (id: string) => void;
  onAsk?: (row: TraceRow) => void;
  aside: string;
}) {
  const [level, setLevel] = useState<ExpandLevel>("everything");
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedFor(rows, "everything"));
  const [showOffsets, setShowOffsets] = useState(true);
  const [showSizes, setShowSizes] = useState(true);
  const [query, setQuery] = useState("");
  const treeRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => childCounts(rows), [rows]);
  const visible = visibleRows(rows, expanded, query);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const current = activeId && visible.some((row) => row.id === activeId) ? activeId : visible[0]?.id ?? null;

  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (id: string) => {
    onActiveChange(id);
    document.getElementById(`trace-row-${id}`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
    const index = visible.findIndex((row) => row.id === current);
    const row = byId.get(current)!;
    const hasChildren = counts.has(current);
    if (event.key === "ArrowDown" && index < visible.length - 1) move(visible[index + 1].id);
    else if (event.key === "ArrowUp" && index > 0) move(visible[index - 1].id);
    else if (event.key === "ArrowRight" && hasChildren) {
      if (!expanded.has(current)) toggle(current);
      else if (visible[index + 1]?.parentId === current) move(visible[index + 1].id);
    } else if (event.key === "ArrowLeft") {
      if (hasChildren && expanded.has(current)) toggle(current);
      else if (row.parentId) move(row.parentId);
    } else if (event.key === "Enter") onOpen(current);
    else return;
    event.preventDefault();
  };

  return (
    <ExpandableCard label="Trace" aside={aside}>
      {(full) => (
        <div className={`flex min-w-0 flex-col gap-3 px-4 pb-4 ${full ? "min-h-0 flex-1" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              Expand
              <Select
                value={level}
                onChange={(event) => {
                  const next = event.target.value as ExpandLevel;
                  setLevel(next);
                  setExpanded(expandedFor(rows, next));
                }}
                className="h-8"
              >
                {EXPAND_LEVELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            <Toggle label="Byte offsets" checked={showOffsets} onChange={setShowOffsets} />
            <Toggle label="Sizes" checked={showSizes} onChange={setShowSizes} />
            <label className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[280px] sm:flex-none">
              <span className="sr-only">Search the trace</span>
              <MagnifyingGlass aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[14px] text-dim" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search field or value" className="h-8 w-full pl-8 font-mono text-xs" />
            </label>
          </div>
          <div
            ref={treeRef}
            role="tree"
            aria-label="Transaction trace"
            aria-activedescendant={current ? `trace-row-${current}` : undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className={`graph-canvas flex flex-col gap-px overflow-x-auto rounded-inner border border-border p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
              full ? "min-h-0 flex-1 overflow-y-auto" : ""
            }`}
          >
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-dim">No field or value starts with “{query.trim()}”.</p>
            ) : (
              visible.map((row, index) => (
                <TraceRowView
                  key={row.id}
                  row={row}
                  index={index}
                  hasChildren={counts.has(row.id)}
                  open={!!query.trim() || expanded.has(row.id)}
                  active={row.id === current}
                  failing={failing.get(row.id)}
                  showOffsets={showOffsets}
                  showSizes={showSizes}
                  onToggle={() => toggle(row.id)}
                  onActivate={() => {
                    onActiveChange(row.id);
                    treeRef.current?.focus({ preventScroll: true });
                  }}
                  onOpen={() => onOpen(row.id)}
                  onAsk={onAsk ? () => onAsk(row) : undefined}
                />
              ))
            )}
          </div>
          <Hint>
            Each row is a real part of the raw transaction, in the order it is serialised; the left number is its byte offset.
            Encrypted note ciphertexts are shown by size only. ↑ ↓ move, ← → fold, Enter opens the details, A asks AI about the row.
          </Hint>
        </div>
      )}
    </ExpandableCard>
  );
}

export function TraceDetails({ row, failing }: { row: TraceRow; failing: string[] | undefined }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge depth={row.depth} kind={row.kind} failing={!!failing} />
        <span className="font-mono text-[13px] text-fg">{row.label}</span>
      </div>
      {row.why && <p className="text-[13px] leading-relaxed text-body">{row.why}</p>}
      {failing && (
        <p className="flex items-start gap-2 text-[13px] text-text">
          <Dot tone="bad" className="mt-[7px]" />
          Failing check: {failing.join(", ")}
        </p>
      )}
      <Inner className="flex flex-col px-3 py-2.5 text-[13px]">
        <div className="flex items-center gap-3 py-1">
          <span className="text-muted">bytes</span>
          <span className="ml-auto font-mono text-xs text-text">
            {row.offset !== null && row.length !== null ? `${formatInt(row.offset)} – ${formatInt(row.offset + row.length)} (${formatInt(row.length)} B)` : "computed, not stored in the transaction"}
          </span>
        </div>
        {row.fields.map((field) => (
          <div key={field.name} className="flex min-w-0 flex-col gap-0.5 py-1">
            <span className="flex items-center gap-2 text-muted">
              {field.name}
              {field.encrypted && <span className="text-[12px] text-dim">encrypted, shown as bytes only</span>}
              {field.value.length > 20 && <span className="ml-auto"><CopyButton value={field.value} label={`Copy ${field.name}`} /></span>}
            </span>
            <span className={`font-mono text-xs break-all ${field.encrypted ? "text-dim" : "text-text"}`}>
              {field.encrypted ? `${field.display} · ${field.value.slice(0, 64)}…` : field.value === field.display ? field.value : `${field.display}${field.value.length > 20 ? "" : ` (${field.value})`}`}
            </span>
            {!field.encrypted && field.value.length > 20 && <span className="font-mono text-[11.5px] break-all text-dim">{field.value}</span>}
          </div>
        ))}
      </Inner>
      <Hint>Byte values are shown in the order they sit in the transaction; prevout txids use explorer (display) order.</Hint>
    </div>
  );
}

export function TraceSkeleton() {
  return (
    <section aria-label="Loading the trace" aria-busy className="flex min-w-0 flex-col rounded-card border border-border bg-card-grad shadow-soft">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-[14px]">
        <span className="size-1.5 flex-none rounded-full bg-dim" />
        <span className="font-medium text-dim">Trace</span>
        <span className="skeleton ml-auto h-3 w-24 rounded-full" />
      </header>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex gap-2" aria-hidden>
          <span className="skeleton h-8 w-36 rounded-tile" />
          <span className="skeleton h-8 w-28 rounded-tile" />
          <span className="skeleton h-8 w-20 rounded-tile" />
        </div>
        <div className="graph-canvas flex flex-col gap-2 rounded-inner border border-border p-3" aria-hidden>
          {[0, 1, 2, 2, 2, 1, 1, 2, 2, 1].map((depth, index) => (
            <div key={index} className="flex items-center gap-2.5">
              <span className="skeleton h-3 w-10 rounded-full" />
              <span style={{ width: depth * 16 }} />
              <span className="skeleton h-[22px] w-24 rounded-[6px]" />
              <span className="skeleton h-3 rounded-full" style={{ width: `${30 + ((index * 17) % 40)}%` }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
