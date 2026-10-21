"use client";

import type { CSSProperties } from "react";
import type { DecodedTx } from "@contract/types";
import { buildNodes, poolFlows, type AnatomyNode, type NodeId } from "@/lib/anatomy";
import { formatInt, formatZec } from "@/lib/format";
import { NODE_ICON } from "./node-icons";
import { ExpandableCard } from "./expandable-card";
import { Dot, Hint, Inner, Meter } from "./ui";

interface Layout {
  name: "wide" | "narrow";
  width: number;
  height: number;
  nodeWidth: number;
  positions: Record<NodeId, { x: number; y: number }>;
}

const NODE_HEIGHT = 44;
const TITLE_GAP = 10;

const WIDE_LAYOUT: Layout = {
  name: "wide",
  width: 820,
  height: 420,
  nodeWidth: 220,
  positions: {
    tx: { x: 16, y: 196 },
    header: { x: 300, y: 36 },
    transparent: { x: 300, y: 116 },
    sapling: { x: 300, y: 196 },
    orchard: { x: 300, y: 276 },
    ironwood: { x: 300, y: 356 },
    fee: { x: 584, y: 196 },
  },
};

const NARROW_LAYOUT: Layout = {
  name: "narrow",
  width: 300,
  height: 560,
  nodeWidth: 220,
  positions: {
    tx: { x: 2, y: 24 },
    header: { x: 52, y: 104 },
    transparent: { x: 52, y: 178 },
    sapling: { x: 52, y: 252 },
    orchard: { x: 52, y: 326 },
    ironwood: { x: 52, y: 400 },
    fee: { x: 2, y: 510 },
  },
};

const BUNDLES: NodeId[] = ["header", "transparent", "sapling", "orchard", "ironwood"];
const POOLS: NodeId[] = ["transparent", "sapling", "orchard", "ironwood"];

function wirePath(layout: Layout, from: NodeId, to: NodeId): string {
  const a = layout.positions[from];
  const b = layout.positions[to];
  const w = layout.nodeWidth;
  if (layout.name === "wide") {
    const x1 = a.x + w;
    const y1 = a.y + NODE_HEIGHT / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_HEIGHT / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }
  if (from === "tx") {
    const x1 = a.x + 32;
    const y1 = a.y + NODE_HEIGHT;
    const x2 = b.x;
    const y2 = b.y + NODE_HEIGHT / 2;
    return `M${x1},${y1} C${x1},${y2} ${x1},${y2} ${x2},${y2}`;
  }
  const x1 = a.x + w;
  const y1 = a.y + NODE_HEIGHT / 2;
  const rail = layout.width - 6;
  const x2 = b.x + w;
  const y2 = b.y + NODE_HEIGHT / 2;
  return `M${x1},${y1} C${rail},${y1} ${rail},${y1 + 20} ${rail},${y1 + 30} L${rail},${y2 - 30} C${rail},${y2 - 10} ${rail},${y2} ${x2},${y2}`;
}

const GRAPH_START_MS = 120;

const NODE_DELAY_MS: Record<NodeId, number> = {
  tx: GRAPH_START_MS,
  header: GRAPH_START_MS + 180,
  transparent: GRAPH_START_MS + 220,
  sapling: GRAPH_START_MS + 260,
  orchard: GRAPH_START_MS + 300,
  ironwood: GRAPH_START_MS + 340,
  fee: GRAPH_START_MS + 820,
};

const TX_WIRE_DELAY_MS = GRAPH_START_MS + 120;
const FEE_WIRE_DELAY_MS = GRAPH_START_MS + 480;

export function delayStyle(ms: number): CSSProperties {
  return { "--d": `${ms}ms` } as CSSProperties;
}

function GraphNode({ node, layout, selected, onSelect }: { node: AnatomyNode; layout: Layout; selected: boolean; onSelect: () => void }) {
  const position = layout.positions[node.id];
  const Icon = NODE_ICON[node.id];
  const w = layout.nodeWidth;
  return (
    <g
      transform={`translate(${position.x},${position.y})`}
      className="group outline-none"
      opacity={node.empty && !selected ? 0.45 : 1}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.title}: ${node.subtitle}${node.failing ? ", has a failing check" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <g className="node-in" style={delayStyle(NODE_DELAY_MS[node.id])}>
      <circle cx={5} cy={-TITLE_GAP - 4} r={3} fill={node.failing ? "var(--red)" : "var(--fg)"} />
      <text x={15} y={-TITLE_GAP} fill="var(--fg)" fontFamily="var(--font-outfit)" fontSize={13} fontWeight={500}>
        {node.title}
      </text>
      <rect
        width={w}
        height={NODE_HEIGHT}
        rx={12}
        fill={`url(#card-grad-${layout.name})`}
        stroke={selected ? "rgba(255,255,255,.13)" : "rgba(255,255,255,.07)"}
        className="group-focus-visible:stroke-[rgba(255,255,255,.4)]"
        filter={selected ? `url(#float-${layout.name})` : undefined}
      />
      <Icon x={12} y={13} width={18} height={18} color="var(--muted)" />
      <text x={38} y={27} fill="var(--port)" fontFamily="var(--font-geist-mono)" fontSize={11.5}>
        {node.subtitle}
      </text>
      </g>
    </g>
  );
}

function NodeGraph({
  layout,
  nodes,
  selected,
  onSelect,
  className,
}: {
  layout: Layout;
  nodes: AnatomyNode[];
  selected: NodeId | null;
  onSelect: (id: NodeId) => void;
  className: string;
}) {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<NodeId, AnatomyNode>;
  const wires = [
    ...BUNDLES.map((id) => ({
      key: `tx-${id}`,
      d: wirePath(layout, "tx", id),
      on: selected === id,
      bad: byId[id].failing,
      faint: byId[id].empty,
      delay: TX_WIRE_DELAY_MS,
    })),
    ...POOLS.filter((id) => !byId[id].empty).map((id) => ({
      key: `${id}-fee`,
      d: wirePath(layout, id, "fee"),
      on: selected === "fee" || selected === id,
      bad: false,
      faint: false,
      delay: FEE_WIRE_DELAY_MS,
    })),
  ];
  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className={className} role="group" aria-label="Transaction anatomy graph">
      <defs>
        <linearGradient id={`card-grad-${layout.name}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2b2f" />
          <stop offset="1" stopColor="#1e1e21" />
        </linearGradient>
        <filter id={`float-${layout.name}`} x="-20%" y="-40%" width="140%" height="200%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>
      {wires.map((wire) => (
        <path
          key={wire.key}
          d={wire.d}
          pathLength={1}
          className={`wire wire-draw ${wire.bad ? "bad" : wire.on ? "on" : ""}`}
          style={delayStyle(wire.delay)}
          opacity={wire.faint && !wire.on ? 0.35 : 1}
        />
      ))}
      {nodes.map((node) => (
        <GraphNode key={node.id} node={node} layout={layout} selected={selected === node.id} onSelect={() => onSelect(node.id)} />
      ))}
    </svg>
  );
}

export function AnatomyView({
  tx,
  feeZat,
  inputValues,
  inputsPending,
  failing,
  selected,
  onSelect,
}: {
  tx: DecodedTx;
  feeZat: number | null;
  inputValues: (number | null)[] | null;
  inputsPending: boolean;
  failing: Set<NodeId>;
  selected: NodeId | null;
  onSelect: (id: NodeId) => void;
}) {
  const nodes = buildNodes(tx, feeZat, failing, inputsPending);
  const flows = poolFlows(tx, inputValues, feeZat, inputsPending);
  const maxAbs = Math.max(1, ...flows.map((flow) => Math.abs(flow.valueZat ?? 0)));
  return (
    <ExpandableCard label="Anatomy" aside={`v${tx.version} · ${formatInt(tx.sizeBytes)} bytes`}>
      {(full) => {
        const graphSize = full ? "max-h-[calc(100dvh-260px)]" : "";
        return (
      <div className={`flex flex-1 flex-col gap-3 px-4 pb-4 ${full ? "justify-center" : ""}`}>
        <Hint>Click a part to see its fields.</Hint>
        <div className="graph-canvas flex flex-col rounded-inner border border-border px-2 py-4">
          <NodeGraph layout={WIDE_LAYOUT} nodes={nodes} selected={selected} onSelect={onSelect} className={`hidden w-full md:block ${graphSize}`} />
          <NodeGraph
            layout={NARROW_LAYOUT}
            nodes={nodes}
            selected={selected}
            onSelect={onSelect}
            className={`mx-auto block w-full md:hidden ${full ? `${graphSize} max-w-[520px]` : "max-w-[360px]"}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {flows.map((flow) => {
            const value = flow.valueZat;
            const direction =
              flow.id === "fee" || value === null || value === 0 ? flow.note : value > 0 ? "value leaves the pool" : "value enters the pool";
            return (
              <Inner key={flow.id} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
                <div className="flex items-center gap-2 truncate text-[12.5px] text-muted" title={flow.field}>
                  <Dot tone={value === null || value === 0 ? "neutral" : "warn"} />
                  {flow.label}
                </div>
                <div className="truncate font-mono text-[14px] text-fg" title={value === null ? undefined : formatZec(value)}>
                  {value === null ? "unknown" : formatZec(value, flow.id !== "fee")}
                </div>
                <Meter value={value === null ? 0 : Math.abs(value) / maxAbs} fillClassName="meter-fill" />
                <div className="truncate text-[12.5px] text-dim" title={direction}>
                  {direction}
                </div>
              </Inner>
            );
          })}
        </div>
        <Hint>
          Only each pool&apos;s net balance is public; individual shielded amounts stay encrypted. Hover a pool for its consensus field.
        </Hint>
      </div>
        );
      }}
    </ExpandableCard>
  );
}

const SKELETON_NODES: NodeId[] = ["tx", "header", "transparent", "sapling", "fee"];

function SkeletonGraph({ layout, className }: { layout: Layout; className: string }) {
  const middle: NodeId[] = ["header", "transparent", "sapling"];
  return (
    <div className={`relative ${className}`} style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="absolute inset-0 size-full" aria-hidden>
        {middle.map((id) => (
          <path key={`tx-${id}`} d={wirePath(layout, "tx", id)} className="wire" opacity={0.25} />
        ))}
        {middle.map((id) => (
          <path key={`${id}-fee`} d={wirePath(layout, id, "fee")} className="wire" opacity={0.25} />
        ))}
      </svg>
      {SKELETON_NODES.map((id) => {
        const position = layout.positions[id];
        return (
          <div
            key={id}
            className="skeleton absolute rounded-inner"
            style={{
              left: `${(position.x / layout.width) * 100}%`,
              top: `${(position.y / layout.height) * 100}%`,
              width: `${(layout.nodeWidth / layout.width) * 100}%`,
              height: `${(NODE_HEIGHT / layout.height) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

export function AnatomySkeleton() {
  return (
    <section aria-label="Loading the anatomy" aria-busy className="flex min-w-0 flex-col rounded-card border border-border bg-card-grad shadow-soft">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-[14px]">
        <span className="size-1.5 flex-none rounded-full bg-dim" />
        <span className="font-medium text-dim">Anatomy</span>
        <span className="skeleton ml-auto h-3 w-24 rounded-full" />
      </header>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="graph-canvas rounded-inner border border-border px-2 py-4">
          <SkeletonGraph layout={WIDE_LAYOUT} className="hidden w-full md:block" />
          <SkeletonGraph layout={NARROW_LAYOUT} className="mx-auto w-full max-w-[360px] md:hidden" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex flex-col gap-2 rounded-inner border border-border bg-inner-grad px-3 py-2.5">
              <span className="skeleton h-3 w-20 rounded-full" />
              <span className="skeleton h-4 w-24 rounded-full" />
              <span className="skeleton h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
