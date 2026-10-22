"use client";

import { useMemo } from "react";
import { CaretRight } from "@phosphor-icons/react";
import type { Check, LuoraZCore, Network, Zip318Reason } from "@contract/types";
import { CONFORMANCE_NOTE, migrationCheck, migrationVerdict, reasonTone } from "@/lib/migration";
import { AskButton } from "./ask-ai";
import { Dot, ExternalLink, Inner } from "./ui";

const FIELD_LABEL: Record<string, string> = {
  "source-actions": "Orchard actions",
  "destination-actions": "Ironwood actions",
  "other-bundles": "Other pools",
  "sole-destination-value": "Amount crossing",
  expiry: "Expiry height",
  fee: "Fee",
  "send-to-self": "Send to self",
  "anchor-on-grid": "Anchor on grid",
};

function ReasonRow({ reason }: { reason: Zip318Reason }) {
  return (
    <Inner className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-3 py-2.5">
      <Dot tone={reasonTone(reason.ok)} className="mt-[7px]" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{FIELD_LABEL[reason.field] ?? reason.field}</p>
        <p className="text-[13px] leading-relaxed break-words text-body">{reason.detail}</p>
      </div>
    </Inner>
  );
}

export function MigrationCard({
  core,
  hex,
  network,
  height,
  onAsk,
}: {
  core: LuoraZCore;
  hex: string;
  network: Network;
  height: number | null;
  onAsk?: (check: Check) => void;
}) {
  const view = useMemo(() => {
    if (height === null) return null;
    try {
      return core.zip318_tx(hex, network, height);
    } catch {
      return null;
    }
  }, [core, hex, network, height]);
  const verdict = view ? migrationVerdict(view) : null;
  if (!view || !verdict) return null;
  const broken = view.reasons.filter((reason) => reason.ok === false);
  const rest = view.reasons.filter((reason) => reason.ok !== false);
  const unknown = rest.filter((reason) => reason.ok === null).length;
  const check = migrationCheck(view);

  return (
    <section aria-label="ZIP 318 migration" className="flex flex-col gap-3 rounded-card border border-border bg-card-grad p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <Dot tone={verdict.tone} className="mt-[9px] size-2" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-[16px] leading-snug text-fg">{verdict.label}</p>
            <ExternalLink href="https://zips.z.cash/zip-0318" className="text-[12.5px]">
              ZIP 318 pool migration
            </ExternalLink>
            {onAsk && check && <AskButton onAsk={() => onAsk(check)} label="Ask AI about this migration label" className="ml-auto" />}
          </div>
          <p className="text-[14px] leading-relaxed text-body">{verdict.shape}</p>
          <p className="text-[12.5px] leading-relaxed text-dim">{CONFORMANCE_NOTE}</p>
        </div>
      </div>

      {broken.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {broken.map((reason) => (
            <ReasonRow key={reason.field} reason={reason} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <details className="group flex flex-col gap-1.5">
          <summary className="flex h-9 list-none items-center gap-2 rounded-tile bg-raised px-3 text-[13px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-white/25 [&::-webkit-details-marker]:hidden">
            <Dot tone="ok" />
            {rest.length - unknown} of {view.reasons.length} shape rules match
            {unknown > 0 ? `, ${unknown} unknown from public data` : ""}
            <CaretRight className="ml-auto text-muted transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {rest.map((reason) => (
              <ReasonRow key={reason.field} reason={reason} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
