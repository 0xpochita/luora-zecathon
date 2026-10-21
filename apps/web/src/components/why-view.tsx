"use client";

import { useState } from "react";
import { FileMagnifyingGlass, Warning } from "@phosphor-icons/react";
import type { Check, ZebraErrorEntry } from "@contract/types";
import { matchZebraError, ZEBRA_STAGES, type ZebraMatch } from "@/lib/zebra-match";
import { zipUrl } from "@/lib/format";
import { CheckRow } from "./checks-view";
import { Chip, EmptyState, ExternalLink, Hint, Inner, InnerHeader, LoadingLine, Textarea } from "./ui";

export type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ZebraErrorEntry[] };

const ZEBRA_REPO = "https://github.com/ZcashFoundation/zebra";

function gitRef(zebraVersion: string): string {
  const commit = zebraVersion.match(/\(([0-9a-f]{7,40})\)/);
  return commit ? commit[1] : zebraVersion.split(/\s+/)[0];
}

function sourceUrl(entry: ZebraErrorEntry): string {
  const path = entry.file.startsWith(`${entry.crate}/`) ? entry.file : `${entry.crate}/${entry.file}`;
  return `${ZEBRA_REPO}/blob/${gitRef(entry.zebraVersion)}/${path}#L${entry.line}`;
}

function StageStrip({ stage }: { stage: ZebraErrorEntry["stage"] }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Zebra validation pipeline">
      {ZEBRA_STAGES.map((item) => {
        const active = item.id === stage;
        return (
          <li
            key={item.id}
            aria-current={active ? "step" : undefined}
            className={`inline-flex h-7 items-center rounded-chip px-2.5 text-[12.5px] ${
              active ? "bg-primary text-primary-fg shadow-soft" : "bg-raised text-dim"
            }`}
          >
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

function MatchCard({ match, primary }: { match: ZebraMatch; primary: boolean }) {
  const { entry } = match;
  return (
    <Inner className="flex flex-col gap-2.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-mono text-[13px] break-all text-fg">{entry.variant}</span>
        <Chip className="ml-auto">matched by {match.reason}</Chip>
      </div>
      <p className="font-mono text-xs break-words text-port">&quot;{entry.message}&quot;</p>
      {primary && <StageStrip stage={entry.stage} />}
      <p className="text-[13px] leading-relaxed text-body">{entry.plain}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        {entry.zips.map((zip) => (
          <ExternalLink key={zip} href={zipUrl(zip)}>
            ZIP {zip}
          </ExternalLink>
        ))}
        <ExternalLink href={sourceUrl(entry)} className="font-mono text-xs">
          {entry.file}:{entry.line}
        </ExternalLink>
        <span className="text-dim">Zebra {entry.zebraVersion}</span>
      </div>
    </Inner>
  );
}

export function WhyView({ catalog, failingChecks, hasTx }: { catalog: CatalogState; failingChecks: Check[]; hasTx: boolean }) {
  const [errorText, setErrorText] = useState("");
  const matches = catalog.status === "ready" ? matchZebraError(errorText, catalog.entries) : [];
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="zebra-error" className="text-[13px] text-muted">
        Paste the error Zebra returned (from <span className="font-mono text-xs">sendrawtransaction</span>, logs or a wallet)
      </label>
      <Textarea
        id="zebra-error"
        rows={3}
        spellCheck={false}
        value={errorText}
        onChange={(event) => setErrorText(event.target.value)}
        placeholder="e.g. the full message after “transaction did not pass consensus validation:”"
        className="font-mono text-xs"
      />
      {catalog.status === "loading" && <LoadingLine>Loading the Zebra error catalog…</LoadingLine>}
      {catalog.status === "error" && (
        <EmptyState icon={<Warning />} title="Zebra error catalog not available">
          {catalog.message}
        </EmptyState>
      )}
      {catalog.status === "ready" && (
        <>
          <Hint>
            Matching runs in this tab against {catalog.entries.length} error variants extracted from Zebra&apos;s source
            {catalog.entries[0] ? ` (${catalog.entries[0].zebraVersion})` : ""}.
          </Hint>
          {errorText.trim() && matches.length === 0 && (
            <EmptyState icon={<FileMagnifyingGlass />} title="No matching Zebra error">
              Nothing in the catalog matches this text. Paste the full message, including the part after the last colon.
            </EmptyState>
          )}
          {matches.map((match, index) => (
            <MatchCard key={match.entry.variant} match={match} primary={index === 0} />
          ))}
        </>
      )}
      {hasTx && (
        <Inner className="flex flex-col gap-2 p-3">
          <InnerHeader icon={<Warning />} aside={`${failingChecks.length} failing`}>
            From the loaded transaction
          </InnerHeader>
          {failingChecks.length === 0 ? (
            <Hint>No check fails for the loaded transaction at the chosen network and height.</Hint>
          ) : (
            failingChecks.map((check) => <CheckRow key={check.id} check={check} />)
          )}
        </Inner>
      )}
    </div>
  );
}
