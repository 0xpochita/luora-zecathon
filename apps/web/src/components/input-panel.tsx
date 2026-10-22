"use client";

import { CaretRight, Info, Sparkle } from "@phosphor-icons/react";
import type { Sample } from "@contract/types";
import { classifyInput } from "@/lib/input";
import { ERROR_CHIP, SAMPLE_CHIPS } from "@/lib/samples";
import { formatInt, NETWORK_LABEL, shortHash } from "@/lib/format";
import { Button, Dot, Hint, LoadingLine, Textarea } from "./ui";

export type LookupState =
  | { status: "idle" }
  | { status: "loading"; txid: string; endpoint: string }
  | { status: "error"; txid: string; message: string };

export type SamplesState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; entries: Sample[] };

export interface Endpoints {
  main: string | null;
  test: string | null;
}

function kindHint(input: string, endpoints: Endpoints): string | null {
  const kind = classifyInput(input);
  switch (kind.kind) {
    case "empty":
      return null;
    case "txid":
      return `txid · looked up through our server at ${endpoints.main ?? "the Mainnet indexer"}, then ${endpoints.test ?? "the Testnet indexer"} if not found`;
    case "hex":
      return "raw transaction · decoded in this tab";
    case "pczt":
      return "PCZT · decoded in this tab";
    case "error":
      return "Zebra error message · matched in this tab";
    case "invalid":
      return kind.reason;
  }
}

function PrivacyNote({ endpoints }: { endpoints: Endpoints }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-dim">
      <Dot tone="ok" />
      <span>Decoded in your browser. Nothing is stored.</span>
      <button
        type="button"
        popoverTarget="privacy-details"
        aria-label="How your data is handled"
        title="How your data is handled"
        className="inline-flex size-6 items-center justify-center rounded-chip text-[14px] text-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
      >
        <Info />
      </button>
      <div
        id="privacy-details"
        popover="auto"
        className="m-auto w-[min(420px,calc(100vw-32px))] rounded-card border border-border bg-card-grad p-4 text-[13px] leading-relaxed text-body shadow-float backdrop:bg-black/40"
      >
        <p className="pb-2 text-[14px] font-medium text-fg">How your data is handled</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>Raw transactions and PCZTs are decoded in this tab with WebAssembly (librustzcash) and never leave it.</li>
          <li>Zebra error messages are matched in this tab against a catalog extracted from Zebra&apos;s source.</li>
          <li>
            Looking up by txid asks <span className="font-mono text-xs text-text">{endpoints.main ?? "the Mainnet indexer"}</span>,
            and <span className="font-mono text-xs text-text">{endpoints.test ?? "the Testnet indexer"}</span> if Mainnet does
            not have it, for that one transaction through our server route. Nothing is logged.
          </li>
          <li>No analytics, no cookies, no viewing keys.</li>
        </ul>
      </div>
    </div>
  );
}

export function InspectBox({
  input,
  onInputChange,
  onInspect,
  inputError,
  lookup,
  endpoints,
  samples,
  onPickSample,
  onPickError,
  compact,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onInspect: () => void;
  inputError: string | null;
  lookup: LookupState;
  endpoints: Endpoints;
  samples: SamplesState;
  onPickSample: (sample: Sample) => void;
  onPickError: (text: string) => void;
  compact: boolean;
}) {
  const hint = kindHint(input, endpoints);
  const chips = samples.status === "ready" ? samples.entries.filter((sample) => SAMPLE_CHIPS[sample.txid]) : [];
  const others = samples.status === "ready" ? samples.entries.filter((sample) => !SAMPLE_CHIPS[sample.txid]) : [];
  return (
    <div className={`flex flex-col gap-3 ${compact ? "" : "items-stretch"}`}>
      <form
        className={`flex flex-col gap-2.5 rounded-card border border-border bg-card-grad shadow-soft ${compact ? "p-2.5" : "glow-top p-4"}`}
        onSubmit={(event) => {
          event.preventDefault();
          onInspect();
        }}
      >
        <label htmlFor="tx-input" className={compact ? "sr-only" : "px-1 text-[14px] font-medium text-fg"}>
          Paste a Zcash transaction, txid, PCZT or Zebra error
        </label>
        <div className={`flex gap-2 ${compact ? "items-center" : "flex-col"}`}>
          <Textarea
            id="tx-input"
            rows={compact ? 1 : 3}
            wrap={compact ? "off" : "soft"}
            spellCheck={false}
            autoComplete="off"
            autoFocus={!compact}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onInspect();
              }
            }}
            placeholder={compact ? "Paste another transaction, txid, PCZT or Zebra error" : "e.g. a 64-character txid, raw hex 0500008…, a PCZT, or the error Zebra returned"}
            aria-invalid={!!inputError}
            aria-describedby="tx-input-hint tx-input-error"
            className={`min-w-0 flex-1 font-mono text-xs ${compact ? "" : "break-all"} ${compact ? "h-9 resize-none! py-2" : "min-h-24"}`}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button type="submit" variant="accent" disabled={lookup.status === "loading"} aria-busy={lookup.status === "loading"}>
              <Sparkle weight="fill" className={lookup.status === "loading" ? "loading-pulse" : ""} />
              {lookup.status === "loading" ? "Inspecting…" : "Inspect"}
            </Button>
            {!compact && (
              <span id="tx-input-hint" className="min-w-0 text-[12.5px] text-dim">
                {hint ?? "Enter to inspect · Shift+Enter for a new line"}
              </span>
            )}
          </div>
        </div>
        {compact && hint && (
          <span id="tx-input-hint" className="px-1 text-[12.5px] text-dim">
            {hint}
          </span>
        )}
        <div id="tx-input-error" aria-live="polite" className="empty:hidden">
          {inputError && (
            <p className="flex items-center gap-2 px-1 text-[13px] text-text">
              <Dot tone="bad" />
              {inputError}
            </p>
          )}
          {lookup.status === "loading" && (
            <LoadingLine>
              Asking {lookup.endpoint} for {shortHash(lookup.txid)}…
            </LoadingLine>
          )}
          {lookup.status === "error" && (
            <p className="flex items-start gap-2 px-1 text-[13px] text-text">
              <Dot tone="bad" className="mt-[7px]" />
              <span>
                Lookup of <span className="font-mono text-xs">{shortHash(lookup.txid)}</span> failed: {lookup.message}
              </span>
            </p>
          )}
        </div>
      </form>

      {!compact && (
        <>
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[12.5px] text-dim">Or try a real transaction:</p>
            {samples.status === "error" && <Hint>Samples not available: {samples.message}</Hint>}
            <div className="flex flex-wrap gap-1.5" aria-busy={samples.status === "loading"}>
              {samples.status === "loading" &&
                [124, 136, 128, 132, 124].map((width, index) => (
                  <span key={index} className="skeleton h-8 rounded-chip" style={{ width }} aria-hidden />
                ))}
              {chips.map((sample) => (
                <button
                  key={sample.txid}
                  type="button"
                  title={`${sample.why} (${NETWORK_LABEL[sample.network]}, height ${formatInt(sample.height)})`}
                  onClick={() => onPickSample(sample)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-chip bg-raised px-3 text-[13px] text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25"
                >
                  {SAMPLE_CHIPS[sample.txid]}
                </button>
              ))}
              {samples.status !== "loading" && (
                <button
                  type="button"
                  title={ERROR_CHIP.why}
                  onClick={() => onPickError(ERROR_CHIP.text)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-chip bg-raised px-3 text-[13px] text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25"
                >
                  <Dot tone="bad" />
                  {ERROR_CHIP.label}
                </button>
              )}
            </div>
            {samples.status === "loading" && <span className="skeleton ml-1 h-3 w-28 rounded-full" aria-hidden />}
            {others.length > 0 && (
              <details className="group px-1">
                <summary className="inline-flex list-none items-center gap-1 rounded-chip text-[12.5px] text-dim outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25 [&::-webkit-details-marker]:hidden">
                  {others.length} more examples
                  <CaretRight className="transition-transform group-open:rotate-90" />
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {others.map((sample) => (
                    <li key={`${sample.network}-${sample.txid}`}>
                      <button
                        type="button"
                        onClick={() => onPickSample(sample)}
                        title={sample.why}
                        className="flex w-full items-center gap-2 rounded-tile px-2.5 py-1.5 text-left text-[13px] text-body outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
                      >
                        {sample.label}
                        <span className="ml-auto font-mono text-[11.5px] text-dim">
                          {NETWORK_LABEL[sample.network]} · {formatInt(sample.height)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
      <PrivacyNote endpoints={endpoints} />
    </div>
  );
}
