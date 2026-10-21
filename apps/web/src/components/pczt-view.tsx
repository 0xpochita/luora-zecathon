"use client";

import { Signature } from "@phosphor-icons/react";
import type { PcztView as PcztData } from "@contract/types";
import { formatZec } from "@/lib/format";
import { CheckRow } from "./checks-view";
import { Dot, EmptyState, Hint, Inner } from "./ui";

export function PcztEmpty() {
  return (
    <EmptyState icon={<Signature />} title="No PCZT loaded">
      <p>
        Paste a PCZT (hex or base64, it starts with the <span className="font-mono text-xs">PCZT</span> magic bytes) into
        the input on the left. It is parsed in this tab and never uploaded.
      </p>
      <p className="mt-2">To make one on testnet with zcash-devtool:</p>
      <pre className="mt-1.5 overflow-x-auto rounded-tile bg-inset p-3 font-mono text-xs text-text">
        {`zcash-devtool pczt create ... > tx.pczt
zcash-devtool pczt prove ... < tx.pczt > proven.pczt
zcash-devtool pczt sign ... < proven.pczt > signed.pczt
zcash-devtool pczt combine ...`}
      </pre>
      <p className="mt-2 text-dim">Each stage is a ZIP 374 role; load the file after any of them to see what is still missing.</p>
    </EmptyState>
  );
}

export function PcztPanel({ pczt }: { pczt: PcztData }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-medium text-fg">Signing progress</h3>
        <ol className="flex flex-wrap gap-1.5" aria-label="ZIP 374 roles">
          {pczt.roles.map((role) => (
            <li
              key={role.name}
              title={role.evidence}
              className={`inline-flex h-7 items-center gap-1.5 rounded-chip bg-raised px-2.5 text-[12.5px] ${role.done ? "text-text" : "text-dim"}`}
            >
              <Dot tone={role.done ? "ok" : "neutral"} />
              {role.name}
              <span className="sr-only">{role.done ? "done" : "not done"}</span>
            </li>
          ))}
        </ol>
        <Hint>Hover a role to see the field that proves it ran.</Hint>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-medium text-fg">Per action</h3>
        {pczt.actions.length === 0 ? (
          <Hint>This PCZT has no actions yet.</Hint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5 text-[12.5px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="px-2.5 font-normal">Action</th>
                  <th className="px-2.5 font-normal">Value</th>
                  <th className="px-2.5 font-normal">Committed recipient</th>
                  <th className="px-2.5 font-normal">Shown to signer</th>
                  <th className="px-2.5 font-normal">Proof</th>
                  <th className="px-2.5 font-normal">Signature</th>
                </tr>
              </thead>
              <tbody>
                {pczt.actions.map((action) => {
                  return (
                    <tr key={`${action.pool}-${action.index}`} className="text-text [&>td]:bg-raised [&>td]:px-2.5 [&>td]:py-2 [&>td:first-child]:rounded-l-chip [&>td:last-child]:rounded-r-chip">
                      <td className="whitespace-nowrap capitalize">
                        {action.pool} #{action.index}
                      </td>
                      <td className="font-mono text-xs whitespace-nowrap">{action.valueZat === null ? "not set" : formatZec(action.valueZat)}</td>
                      <td className="max-w-[180px] truncate font-mono text-xs" title={action.recipient ?? undefined}>
                        {action.recipient ?? "not set"}
                      </td>
                      <td className="max-w-[180px] truncate font-mono text-xs" title={action.userAddress ?? undefined}>
                        {action.userAddress ?? "not set"}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone={action.proof ? "ok" : "neutral"} />
                          {action.proof ? "present" : "missing"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone={action.signature ? "ok" : "neutral"} />
                          {action.signature ? "present" : "missing"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[14px] font-medium text-fg">Signer checks</h3>
        {pczt.checks.length === 0 ? (
          <Hint>No signer checks were returned.</Hint>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pczt.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        )}
      </section>
      <Inner className="p-3">
        <Hint>
          A signer that only shows <span className="font-mono">user_address</span> can be shown a different payee than the
          one committed in the action (librustzcash #3155). A failing signer check above marks such a mismatch.
        </Hint>
      </Inner>
    </div>
  );
}
