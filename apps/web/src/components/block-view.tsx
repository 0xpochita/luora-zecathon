"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Network } from "@contract/types";
import type { BlockLookup } from "@/lib/api";
import type { BlockTxSummary } from "@/server/block";
import type { TraceRowKind } from "@/lib/trace";
import { formatInt, NETWORK_LABEL, shortHash } from "@/lib/format";
import { delayStyle } from "./anatomy-view";
import { ExpandableCard } from "./expandable-card";
import { FieldInline, KindBadge } from "./trace-view";
import { Chip, CopyButton, Hint, Inner, Select } from "./ui";

interface PoolLine {
  kind: TraceRowKind;
  fields: [string, string][];
}

function poolLines(tx: BlockTxSummary): PoolLine[] {
  const lines: PoolLine[] = [];
  if (tx.coinbase || tx.transparentInputs + tx.transparentOutputs > 0)
    lines.push({ kind: "TRANSPARENT", fields: [["vin", tx.coinbase ? "coinbase" : String(tx.transparentInputs)], ["vout", String(tx.transparentOutputs)]] });
  if (tx.saplingSpends + tx.saplingOutputs > 0)
    lines.push({ kind: "SAPLING", fields: [["spends", String(tx.saplingSpends)], ["outputs", String(tx.saplingOutputs)]] });
  if (tx.orchardActions > 0) lines.push({ kind: "ORCHARD", fields: [["actions", String(tx.orchardActions)]] });
  if (tx.ironwoodActions > 0) lines.push({ kind: "IRONWOOD", fields: [["actions", String(tx.ironwoodActions)]] });
  return lines;
}

function utcTime(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function Guides({ depth }: { depth: number }) {
  return <span aria-hidden className="trace-guides w-[calc(var(--depth)*10px)] flex-none self-stretch sm:w-[calc(var(--depth)*16px)]" style={{ "--depth": depth } as CSSProperties} />;
}

function Line({ depth, kind, children }: { depth: number; kind: TraceRowKind; children: ReactNode }) {
  return (
    <span className="flex min-h-7 items-start gap-2 sm:min-w-max sm:items-center">
      <Guides depth={depth} />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12.5px] sm:flex-nowrap">
        <KindBadge depth={depth} kind={kind} failing={false} />
        {children}
      </span>
    </span>
  );
}

function HeaderField({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex-none text-muted sm:w-28">{name}</span>
      <span className="flex min-w-0 items-center gap-2 font-mono text-xs break-all text-text">{children}</span>
    </div>
  );
}

export function BlockTraceView({
  block,
  onOpenTx,
  onOpenBlock,
  onNetworkChange,
}: {
  block: BlockLookup;
  onOpenTx: (txid: string) => void;
  onOpenBlock: (hash: string) => void;
  onNetworkChange: (network: Network) => void;
}) {
  return (
    <ExpandableCard label="Block Trace" aside={`${NETWORK_LABEL[block.network]} · ${formatInt(block.txs.length)} transactions`}>
      {(full) => (
        <div className={`flex min-w-0 flex-col gap-3 px-4 pb-4 ${full ? "min-h-0 flex-1" : ""}`}>
          <Inner className="flex flex-col px-3 py-2.5 text-[13px]">
            <HeaderField name="network">
              <Select aria-label="Network" value={block.network} onChange={(event) => onNetworkChange(event.target.value === "test" ? "test" : "main")} className="h-7 font-sans">
                <option value="main">Mainnet</option>
                <option value="test">Testnet</option>
              </Select>
            </HeaderField>
            <HeaderField name="height">{formatInt(block.height)}</HeaderField>
            <HeaderField name="hash">
              {block.hash}
              <CopyButton value={block.hash} label="Copy block hash" />
            </HeaderField>
            <HeaderField name="time">{block.time !== null ? utcTime(block.time) : "not reported by the indexer"}</HeaderField>
            <HeaderField name="previous block">
              {block.prevHash ? (
                <button type="button" onClick={() => onOpenBlock(block.prevHash!)} className="border-b border-border-strong text-left break-all text-body transition-colors hover:text-fg" title="Open the previous block">
                  {block.prevHash}
                </button>
              ) : (
                "not reported by the indexer"
              )}
            </HeaderField>
          </Inner>
          <div
            role="list"
            aria-label="Transactions in this block"
            className={`graph-canvas flex flex-col gap-px overflow-x-auto rounded-inner border border-border p-1.5 ${full ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
          >
            <div role="listitem" className="px-2 py-1">
              <Line depth={0} kind="HEADER">
                <span className="font-medium text-fg">block {formatInt(block.height)}</span>
                <FieldInline name="txs" display={formatInt(block.txs.length)} />
              </Line>
            </div>
            {block.txs.map((tx, index) => (
              <div role="listitem" key={tx.txid}>
                <button
                  type="button"
                  onClick={() => onOpenTx(tx.txid)}
                  aria-label={`Inspect transaction ${tx.index}${tx.coinbase ? " (coinbase)" : ""} ${tx.txid}`}
                  style={delayStyle(Math.min(index * 18, 360))}
                  className="node-in flex w-full cursor-pointer flex-col rounded-chip px-2 py-1 text-left outline-none hover:bg-overlay/[.035] focus-visible:bg-hover focus-visible:shadow-[inset_2px_0_0_var(--fg)] sm:min-w-max"
                >
                  <Line depth={1} kind="TX">
                    <span className="text-fg sm:hidden">{shortHash(tx.txid, 10, 8)}</span>
                    <span className="hidden text-fg sm:inline">{tx.txid}</span>
                    <FieldInline name="index" display={String(tx.index)} />
                    {tx.coinbase && <Chip className="h-[22px] font-sans">coinbase</Chip>}
                  </Line>
                  {poolLines(tx).map((line) => (
                    <Line key={line.kind} depth={2} kind={line.kind}>
                      <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[12px]">
                        {line.fields.map(([name, display]) => (
                          <FieldInline key={name} name={name} display={display} />
                        ))}
                      </span>
                    </Line>
                  ))}
                </button>
              </div>
            ))}
          </div>
          <Hint>
            Read from the indexer&apos;s compact block: per-pool counts, not amounts or addresses. The first transaction is the
            coinbase, whose null input the compact format leaves out. Pick a transaction to inspect it.
          </Hint>
        </div>
      )}
    </ExpandableCard>
  );
}
