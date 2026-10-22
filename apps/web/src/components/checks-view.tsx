"use client";

import { CaretRight } from "@phosphor-icons/react";
import type { Check, CheckStatus } from "@contract/types";
import { formatInt } from "@/lib/format";
import { AskButton } from "./ask-ai";
import { Chip, Dot, ExternalLink, Hint, Inner, Input, Select, StatusMark } from "./ui";

const ORDER: CheckStatus[] = ["fail", "warn", "pass", "na"];

export function CheckRow({
  check,
  onAsk,
  onShowOffset,
  focused = false,
}: {
  check: Check;
  onAsk?: (check: Check) => void;
  onShowOffset?: (offset: number) => void;
  focused?: boolean;
}) {
  return (
    <div id={`check-${check.id}`} className={`scroll-mt-24 rounded-inner transition-shadow ${focused ? "ring-2 ring-white/30" : ""}`}>
    <Inner className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="pt-px">
        <StatusMark status={check.status} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{check.title}</p>
        <p className="text-[13px] leading-relaxed break-words text-body">{check.detail}</p>
        {check.offset !== undefined && onShowOffset && (
          <button type="button" onClick={() => onShowOffset(check.offset!)} className="link mt-0.5 text-left text-[12.5px]">
            Show byte {formatInt(check.offset)} in Trace
          </button>
        )}
        {check.source && <p className="mt-0.5 truncate font-mono text-xs text-dim" title={check.source}>{check.source}</p>}
      </div>
      <div className="col-start-2 flex min-w-0 items-start gap-2 self-start sm:col-start-3 sm:max-w-[290px] sm:justify-end">
        {check.zip ? (
          <ExternalLink href={check.zip.url} className="min-w-0 text-[12.5px] break-words sm:text-right">
            ZIP {check.zip.number}
            {check.zip.clause ? ` · ${check.zip.clause}` : ""}
          </ExternalLink>
        ) : (
          <span className="text-[12.5px] text-dim">no ZIP</span>
        )}
        {onAsk && <AskButton onAsk={() => onAsk(check)} label={`Ask AI about ${check.title}`} className="-mt-0.5" />}
      </div>
    </Inner>
    </div>
  );
}

export type CheckAt = "mined" | "tip" | "custom" | "nu7";

export interface Nu7Option {
  label: string;
  disabledReason: string | null;
  note: string | null;
}

export function CheckAtControl({
  value,
  onChange,
  minedHeight,
  tipHeight,
  heightText,
  onHeightChange,
  heightInvalid,
  upgradeName,
  nu7,
}: {
  value: CheckAt;
  onChange: (value: CheckAt) => void;
  minedHeight: number | null;
  tipHeight: number | null;
  heightText: string;
  onHeightChange: (value: string) => void;
  heightInvalid: boolean;
  upgradeName: string | null;
  nu7?: Nu7Option;
}) {
  return (
    <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="check-at" className="text-[13px] text-muted">
        Check at
      </label>
      <Select id="check-at" value={value} onChange={(event) => onChange(event.target.value as CheckAt)} className="h-8">
        {minedHeight !== null && <option value="mined">height it was mined ({formatInt(minedHeight)})</option>}
        <option value="tip">current tip{tipHeight !== null ? ` (${formatInt(tipHeight)})` : ""}</option>
        <option value="custom">another height…</option>
        {nu7 && (
          <option value="nu7" disabled={nu7.disabledReason !== null}>
            {nu7.disabledReason ?? nu7.label}
          </option>
        )}
      </Select>
      {nu7 && value !== "nu7" && nu7.disabledReason === null && (
        <button
          type="button"
          onClick={() => onChange("nu7")}
          className="inline-flex h-8 items-center rounded-tile bg-raised px-3 text-[13px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25"
        >
          Check at NU7
        </button>
      )}
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
    {nu7?.note && value === "nu7" && <Hint>{nu7.note}</Hint>}
    </div>
  );
}

export function ChecksView({
  checks,
  onAsk,
  onShowOffset,
  focusId = null,
}: {
  checks: Check[];
  onAsk?: (check: Check) => void;
  onShowOffset?: (offset: number) => void;
  focusId?: string | null;
}) {
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
            <CheckRow key={check.id} check={check} onAsk={onAsk} onShowOffset={onShowOffset} focused={check.id === focusId} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <details className="group flex flex-col gap-1.5" open={rest.some((check) => check.id === focusId)}>
          <summary className="flex h-9 list-none items-center gap-2 rounded-tile bg-raised px-3 text-[13px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25 [&::-webkit-details-marker]:hidden">
            <Dot tone="ok" />
            {passed} rule{passed === 1 ? "" : "s"} passed
            {skipped > 0 ? `, ${skipped} not applicable` : ""}
            <CaretRight className="ml-auto text-muted transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {rest.map((check) => (
              <CheckRow key={check.id} check={check} onAsk={onAsk} onShowOffset={onShowOffset} focused={check.id === focusId} />
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

export function RulesSkeleton() {
  return (
    <div aria-busy aria-label="Running the rules" className="flex flex-col gap-1.5">
      {[0, 1, 2, 3].map((index) => (
        <Inner key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-3 py-2.5">
          <span className="skeleton mt-0.5 h-3 w-10 rounded-full" />
          <span className="flex flex-col gap-2">
            <span className="skeleton h-3.5 w-40 rounded-full" />
            <span className="skeleton h-3 w-[80%] rounded-full" />
          </span>
        </Inner>
      ))}
    </div>
  );
}
