"use client";

import type { Check, CheckStatus, Network } from "@contract/types";
import { formatInt, NETWORK_LABEL } from "@/lib/format";
import { Chip, ExternalLink, Hint, Inner, STATUS_TONE, StatusMark } from "./ui";

const ORDER: CheckStatus[] = ["fail", "warn", "pass", "na"];
const SUMMARY_LABEL: Record<CheckStatus, string> = { pass: "pass", fail: "fail", warn: "warn", na: "n/a" };

export function CheckRow({ check }: { check: Check }) {
  return (
    <Inner className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[auto_1fr_auto]">
      <div className="pt-px">
        <StatusMark status={check.status} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{check.title}</p>
        <p className="text-[13px] leading-relaxed break-words text-body">{check.detail}</p>
        {check.source && <p className="mt-0.5 truncate font-mono text-xs text-dim" title={check.source}>{check.source}</p>}
      </div>
      {check.zip ? (
        <ExternalLink href={check.zip.url} className="col-start-2 self-start justify-self-start text-[12.5px] whitespace-nowrap sm:col-start-3">
          ZIP {check.zip.number}
          {check.zip.clause ? ` · ${check.zip.clause}` : ""}
        </ExternalLink>
      ) : (
        <span className="col-start-2 text-[12.5px] text-dim sm:col-start-3">no ZIP</span>
      )}
    </Inner>
  );
}

export function ChecksView({ checks, network, height }: { checks: Check[]; network: Network; height: number }) {
  const sorted = [...checks].sort((left, right) => ORDER.indexOf(left.status) - ORDER.indexOf(right.status));
  const counts = ORDER.map((status) => ({ status, count: checks.filter((check) => check.status === status).length }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {counts.map(({ status, count }) => (
          <Chip key={status} tone={STATUS_TONE[status]} dot>
            {count} {SUMMARY_LABEL[status]}
          </Chip>
        ))}
        <Chip>
          rules for {NETWORK_LABEL[network]} at height <span className="font-mono text-xs">{formatInt(height)}</span>
        </Chip>
      </div>
      {sorted.length === 0 ? (
        <Hint>The decoder returned no checks for this transaction.</Hint>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sorted.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      )}
      <Hint>
        Change the network or the height in the top bar and every rule re-runs here, in this tab. Checks cover the public
        structure only; proofs and signatures are checked for presence and size, not verified.
      </Hint>
    </div>
  );
}
