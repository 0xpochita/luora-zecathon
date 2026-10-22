"use client";

import type { ReactNode } from "react";
import { ArrowClockwise, CaretRight } from "@phosphor-icons/react";
import type { DecodedTx, Network } from "@contract/types";
import { formatInt, formatZec, NETWORK_LABEL, shortHash, zipUrl } from "@/lib/format";
import { feeLabel } from "@/lib/fee";
import { expiryText, feeText as mempoolFeeText, stuckReason, type MempoolStatus } from "@/lib/mempool";
import type { RulesSummary } from "@/lib/summary";
import { Button, CopyButton, Dot, ExternalLink, Inner, LoadingLine, Select } from "./ui";

export type RulesLine = { status: "ready"; summary: RulesSummary } | { status: "pending"; text: string } | { status: "error"; text: string };

export interface PrevoutNotice {
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
  endpoint: string;
  onFetch: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Inner className="flex min-w-0 flex-col gap-1 px-3 py-2.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-[13px] text-text">{children}</span>
    </Inner>
  );
}

export function VerdictCard({
  tx,
  movement,
  feeZat,
  inputsPending,
  rules,
  network,
  networkNote,
  onNetworkChange,
  minedHeight,
  origin,
  prevoutNotice,
  mempool,
  actions,
  onShowRules,
  onShowDetails,
}: {
  tx: DecodedTx;
  movement: string;
  feeZat: number | null;
  inputsPending: boolean;
  rules: RulesLine;
  network: Network;
  networkNote: string | null;
  onNetworkChange: ((network: Network) => void) | null;
  minedHeight: number | null;
  origin: "pasted" | "lookup";
  prevoutNotice: PrevoutNotice | null;
  mempool: MempoolStatus | null;
  actions?: ReactNode;
  onShowRules: () => void;
  onShowDetails: () => void;
}) {
  const tone = rules.status === "ready" ? rules.summary.tone : rules.status === "error" ? "bad" : "neutral";
  const fee = feeLabel(feeZat, inputsPending, tx.transparent.inputs.some((input) => input.isCoinbase));
  const feeText =
    feeZat !== null ? (
      `Fee ${formatZec(feeZat)}.`
    ) : inputsPending ? (
      "Fee: fetching the values of the spent inputs…"
    ) : fee.why ? (
      <span title={fee.why} className="underline decoration-dotted decoration-overlay/30 underline-offset-4">
        Fee: {fee.text}.
      </span>
    ) : null;
  return (
    <section aria-label="Verdict" className="flex flex-col gap-3 rounded-card border border-border bg-card-grad p-4 shadow-soft">
      <div className="flex flex-wrap items-start gap-3">
        <Dot tone={mempool ? (mempool.expired ? "bad" : "warn") : tone} className="mt-[9px] size-2" />
        <div className="flex min-w-[15rem] flex-1 flex-col gap-1">
          {mempool && <p className="text-[16px] leading-snug font-medium text-fg">In the mempool, not mined yet.</p>}
          <p className="text-[16px] leading-snug text-fg">{movement}</p>
          <p className="text-[14px] leading-relaxed text-body">
            {feeText}{" "}
            {rules.status === "ready" ? (
              <button type="button" onClick={onShowRules} className="link text-left">
                {rules.summary.text}
              </button>
            ) : (
              rules.text
            )}
          </p>
        </div>
        {actions && <div className="ml-auto flex flex-none items-center gap-2">{actions}</div>}
      </div>

      {mempool && <MempoolPanel status={mempool} />}

      {prevoutNotice && (
        <Inner className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-[12.5px] text-dim">
          <span className="min-w-0 flex-1">
            The fee needs the value of each spent transparent output, which is not inside the transaction. Fetching asks{" "}
            <span className="font-mono text-xs text-muted">{prevoutNotice.endpoint}</span> about those outputs.
          </span>
          {prevoutNotice.status === "loading" ? (
            <LoadingLine>Fetching input values…</LoadingLine>
          ) : (
            <Button size="sm" variant="secondary" onClick={prevoutNotice.onFetch}>
              <ArrowClockwise />
              Fetch input values
            </Button>
          )}
          {prevoutNotice.message && <p className="w-full text-text">{prevoutNotice.message}</p>}
        </Inner>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Fact label="Network">
          {onNetworkChange ? (
            <Select
              aria-label="Network to decode with"
              value={network}
              onChange={(event) => onNetworkChange(event.target.value === "test" ? "test" : "main")}
              className="h-7 w-full"
            >
              <option value="main">Mainnet</option>
              <option value="test">Testnet</option>
            </Select>
          ) : (
            <span className="truncate" title={networkNote ?? undefined}>
              {NETWORK_LABEL[network]}
              {networkNote ? <span className="text-dim"> · {networkNote}</span> : null}
            </span>
          )}
        </Fact>
        <Fact label="Mined at">
          <span className="truncate">
            {minedHeight !== null ? (
              <span className="font-mono text-xs">{formatInt(minedHeight)}</span>
            ) : origin === "pasted" ? (
              "unknown (pasted)"
            ) : mempool ? (
              "in the mempool"
            ) : (
              "not mined yet"
            )}
          </span>
        </Fact>
        <Fact label="Fee">
          <span className={`truncate ${fee.known ? "font-mono text-xs" : ""}`} title={fee.why ?? undefined}>
            {fee.text}
          </span>
        </Fact>
        <Fact label="Transaction">
          <span className="truncate font-mono text-xs" title={tx.txid}>
            {shortHash(tx.txid, 6, 4)}
          </span>
          <CopyButton value={tx.txid} label="Copy txid" />
          <button
            type="button"
            onClick={onShowDetails}
            className="ml-auto inline-flex flex-none items-center gap-0.5 rounded-chip text-[12.5px] text-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-overlay/25"
          >
            Details
            <CaretRight />
          </button>
        </Fact>
      </div>
    </section>
  );
}

function MempoolPanel({ status }: { status: MempoolStatus }) {
  const blockers = status.blockers;
  return (
    <Inner className="flex flex-col gap-2 px-3 py-2.5 text-[13px]">
      <p className="text-text">{stuckReason(status)}</p>
      <ul className="flex flex-col gap-1.5 text-body">
        <li className="flex items-start gap-2">
          <Dot tone={status.expired ? "bad" : status.blocksLeft !== null && status.blocksLeft <= 10 ? "warn" : "neutral"} className="mt-[7px]" />
          <span className="min-w-0">
            {expiryText(status)}{" "}
            <ExternalLink href={zipUrl(203)} className="text-[12.5px]">
              ZIP 203
            </ExternalLink>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Dot tone={status.fee === "meets-zip317" ? "ok" : status.fee === "unavailable" ? "neutral" : "warn"} className="mt-[7px]" />
          <span className="min-w-0">
            {mempoolFeeText(status)}{" "}
            <ExternalLink href={zipUrl(317)} className="text-[12.5px]">
              ZIP 317
            </ExternalLink>{" "}
            <ExternalLink href={zipUrl(2009)} className="text-[12.5px]">
              ZIP 2009
            </ExternalLink>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Dot tone={blockers.some((check) => check.status === "fail") ? "bad" : blockers.length > 0 ? "warn" : "ok"} className="mt-[7px]" />
          <span className="min-w-0">
            {blockers.length === 0
              ? `No rule fails or warns at the next block, ${formatInt(status.nextBlock)} (tip + 1).`
              : `At the next block, ${formatInt(status.nextBlock)} (tip + 1): ${blockers.map((check) => `${check.title} ${check.status === "fail" ? "fails" : "warns"}`).join("; ")}.`}
          </span>
        </li>
      </ul>
    </Inner>
  );
}

export function VerdictSkeleton() {
  return (
    <section aria-label="Loading the verdict" aria-busy className="flex flex-col gap-3 rounded-card border border-border bg-card-grad p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="mt-[9px] size-2 flex-none rounded-full bg-dim" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
          <span className="skeleton h-4 w-[72%] rounded-full" />
          <span className="skeleton h-3.5 w-[48%] rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Inner key={index} className="flex flex-col gap-2 px-3 py-2.5">
            <span className="skeleton h-3 w-14 rounded-full" />
            <span className="skeleton h-3.5 w-24 rounded-full" />
          </Inner>
        ))}
      </div>
    </section>
  );
}
