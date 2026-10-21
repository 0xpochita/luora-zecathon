"use client";

import { ArrowClockwise, Sparkle } from "@phosphor-icons/react";
import type { Network, Sample } from "@contract/types";
import { classifyInput } from "@/lib/input";
import { formatInt, NETWORK_LABEL, shortHash } from "@/lib/format";
import type { LoadedTx } from "./inspector-app";
import { Button, Chip, Dot, Hint, Inner, LoadingLine, Panel, Textarea } from "./ui";

export type LookupState =
  | { status: "idle" }
  | { status: "loading"; txid: string }
  | { status: "error"; txid: string; message: string };

export type SamplesState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; entries: Sample[] };

const KIND_LABEL = {
  empty: null,
  txid: "txid · looked up through the server",
  hex: "raw hex · decoded in this tab",
  pczt: "PCZT · decoded in this tab",
  invalid: "not recognised",
} as const;

export function InputPanel({
  input,
  onInputChange,
  onInspect,
  inputError,
  lookup,
  endpoint,
  network,
  samples,
  onPickSample,
  loaded,
  prevoutNotice,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onInspect: () => void;
  inputError: string | null;
  lookup: LookupState;
  endpoint: string | null;
  network: Network;
  samples: SamplesState;
  onPickSample: (sample: Sample) => void;
  loaded: LoadedTx | null;
  prevoutNotice: { status: string; message: string | null; onFetch: () => void } | null;
}) {
  const kind = classifyInput(input).kind;
  const endpointText = endpoint ?? "the indexer configured on this server";
  return (
    <Panel label="Inspect a transaction" bodyClassName="gap-3 px-4 pb-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onInspect();
        }}
      >
        <label htmlFor="tx-input" className="text-[13px] text-muted">
          Raw hex, a txid, or a PCZT
        </label>
        <Textarea
          id="tx-input"
          rows={6}
          spellCheck={false}
          autoComplete="off"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onInspect();
            }
          }}
          placeholder="050000800a27a726… or a 64-character txid"
          aria-invalid={!!inputError}
          aria-describedby="tx-input-privacy tx-input-error"
          className="font-mono text-xs break-all"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="accent" disabled={lookup.status === "loading"}>
            <Sparkle weight="fill" />
            Inspect
          </Button>
          {KIND_LABEL[kind] && <span className="text-[12.5px] text-dim">{KIND_LABEL[kind]}</span>}
        </div>
        <p id="tx-input-privacy" className="flex gap-2 text-[12.5px] text-dim">
          <Dot tone="ok" className="mt-[7px]" />
          <span>
            Hex and PCZTs are decoded in this tab and never leave it. Looking up by txid asks{" "}
            <span className="font-mono text-xs text-muted">{endpointText}</span> ({NETWORK_LABEL[network]}) for that
            transaction through our server route; nothing is logged.
          </span>
        </p>
        <div id="tx-input-error" aria-live="polite">
          {inputError && (
            <p className="flex items-center gap-2 text-[13px] text-text">
              <Dot tone="bad" />
              {inputError}
            </p>
          )}
          {lookup.status === "loading" && <LoadingLine>Asking {endpointText} for {shortHash(lookup.txid)}…</LoadingLine>}
          {lookup.status === "error" && (
            <p className="flex items-start gap-2 text-[13px] text-text">
              <Dot tone="bad" className="mt-[7px]" />
              <span>
                Lookup of <span className="font-mono text-xs">{shortHash(lookup.txid)}</span> failed: {lookup.message}
              </span>
            </p>
          )}
        </div>
      </form>

      {loaded && (
        <Inner className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px]">
          <p className="text-[13px] text-text">Loaded</p>
          <p className="text-dim">
            {loaded.origin === "pasted"
              ? "Pasted hex, decoded locally."
              : `From ${loaded.endpoint ?? "the indexer"}${loaded.minedHeight !== null ? `, mined at height ${formatInt(loaded.minedHeight)}` : ", not mined yet"}.`}
          </p>
          {prevoutNotice && (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-dim">
                The fee needs the value of each transparent input, which is not in the transaction itself. Fetching asks{" "}
                {endpointText} about the spent outputs.
              </p>
              {prevoutNotice.status === "loading" ? (
                <LoadingLine>Fetching input values…</LoadingLine>
              ) : (
                <Button size="sm" variant="secondary" onClick={prevoutNotice.onFetch} className="self-start">
                  <ArrowClockwise />
                  Fetch input values
                </Button>
              )}
              {prevoutNotice.message && <p className="text-text">{prevoutNotice.message}</p>}
            </div>
          )}
        </Inner>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[14px]">
          <span className="size-1.5 flex-none rounded-full bg-fg" />
          <span className="font-medium text-fg">Samples</span>
          <span className="ml-auto text-[12.5px] text-dim">real txids</span>
        </div>
        {samples.status === "loading" && <LoadingLine>Loading samples…</LoadingLine>}
        {samples.status === "error" && <Hint>Samples not available: {samples.message}</Hint>}
        {samples.status === "ready" && samples.entries.length === 0 && <Hint>No samples published yet.</Hint>}
        {samples.status === "ready" && (
          <ul className="flex flex-col gap-1.5">
            {samples.entries.map((sample) => (
              <li key={`${sample.network}-${sample.txid}`}>
                <button
                  type="button"
                  onClick={() => onPickSample(sample)}
                  aria-pressed={loaded?.txid === sample.txid}
                  className={`flex w-full flex-col gap-0.5 rounded-tile px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                    loaded?.txid === sample.txid ? "bg-primary text-primary-fg shadow-soft" : "bg-raised text-text hover:bg-hover"
                  }`}
                >
                  <span className="text-[13px]">{sample.label}</span>
                  <span className={`text-[12.5px] ${loaded?.txid === sample.txid ? "text-primary-fg/70" : "text-dim"}`}>{sample.why}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className={`font-mono text-[11.5px] ${loaded?.txid === sample.txid ? "text-primary-fg/70" : "text-dim"}`}>
                      {NETWORK_LABEL[sample.network]} · {formatInt(sample.height)} · {shortHash(sample.txid, 6, 4)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Inner className="mt-auto flex flex-col gap-1.5 p-3">
        <p className="text-[13px] text-text">Why this tool</p>
        <Hint>
          Explorers show Ironwood transfers as 0.0 ZEC, <span className="font-mono">zcash-devtool inspect</span> cannot read v6
          yet, and Zebra&apos;s <span className="font-mono">sendrawtransaction</span> returns one error code for every failure.
          luora z shows the structure, the rules and the reason.
        </Hint>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Chip>v4 · v5 · v6</Chip>
          <Chip>NU6.3 Ironwood</Chip>
        </div>
      </Inner>
    </Panel>
  );
}
