"use client";

import { CaretRight } from "@phosphor-icons/react";
import type { Check, CheckStatus } from "@contract/types";
import { formatInt } from "@/lib/format";
import { Chip, Dot, ExternalLink, Hint, Inner, Input, Select, StatusMark } from "./ui";

const ORDER: CheckStatus[] = ["fail", "warn", "pass", "na"];

export function CheckRow({ check }: { check: Check }) {
  return (
    <Inner className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="pt-px">
        <StatusMark status={check.status} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{check.title}</p>
        <p className="text-[13px] leading-relaxed break-words text-body">{check.detail}</p>
        {check.source && <p className="mt-0.5 truncate font-mono text-xs text-dim" title={check.source}>{check.source}</p>}
      </div>
      {check.zip ? (
        <ExternalLink href={check.zip.url} className="col-start-2 min-w-0 self-start justify-self-start text-[12.5px] break-words sm:col-start-3 sm:max-w-[260px] sm:text-right">
          ZIP {check.zip.number}
          {check.zip.clause ? ` · ${check.zip.clause}` : ""}
        </ExternalLink>
      ) : (
        <span className="col-start-2 text-[12.5px] text-dim sm:col-start-3">no ZIP</span>
      )}
    </Inner>
  );
}

export type CheckAt = "mined" | "tip" | "custom";

export function CheckAtControl({
  value,
  onChange,
  minedHeight,
  tipHeight,
  heightText,
  onHeightChange,
  heightInvalid,
  upgradeName,
}: {
  value: CheckAt;
  onChange: (value: CheckAt) => void;
  minedHeight: number | null;
  tipHeight: number | null;
  heightText: string;
  onHeightChange: (value: string) => void;
  heightInvalid: boolean;
  upgradeName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="check-at" className="text-[13px] text-muted">
        Check at
      </label>
      <Select id="check-at" value={value} onChange={(event) => onChange(event.target.value as CheckAt)} className="h-8">
        {minedHeight !== null && <option value="mined">height it was mined ({formatInt(minedHeight)})</option>}
        <option value="tip">current tip{tipHeight !== null ? ` (${formatInt(tipHeight)})` : ""}</option>
        <option value="custom">another height…</option>
      </Select>
      {value === "custom" && (
        <Input
          aria-label="Height"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={heightText}
          onChange={(event) => onHeightChange(event.target.value)}
          placeholder="e.g. 3,428,142"
          aria-invalid={heightInvalid}
          className={`h-8 w-[132px] font-mono text-xs ${heightInvalid ? "border-red/60" : ""}`}
        />
      )}
      {heightInvalid ? (
        <Chip tone="bad" dot>
          not a height
        </Chip>
      ) : (
        upgradeName && <Chip title="Network upgrade whose rules apply at this height">{upgradeName} rules</Chip>
      )}
    </div>
  );
}

export function ChecksView({ checks }: { checks: Check[] }) {
  const sorted = [...checks].sort((left, right) => ORDER.indexOf(left.status) - ORDER.indexOf(right.status));
  const attention = sorted.filter((check) => check.status === "fail" || check.status === "warn");
  const rest = sorted.filter((check) => check.status === "pass" || check.status === "na");
  const passed = rest.filter((check) => check.status === "pass").length;
  const skipped = rest.length - passed;
  if (sorted.length === 0) return <Hint>The decoder returned no checks for this transaction.</Hint>;
  return (
    <div className="flex flex-col gap-3">
      {attention.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {attention.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <details className="group flex flex-col gap-1.5">
          <summary className="flex h-9 list-none items-center gap-2 rounded-tile bg-raised px-3 text-[13px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25 [&::-webkit-details-marker]:hidden">
            <Dot tone="ok" />
            {passed} rule{passed === 1 ? "" : "s"} passed
            {skipped > 0 ? `, ${skipped} not applicable` : ""}
            <CaretRight className="ml-auto text-muted transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {rest.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        </details>
      )}
      <Hint>
        Rules run in this tab against the public structure. Proofs and signatures are checked for presence and size, not
        verified.
      </Hint>
    </div>
  );
}
