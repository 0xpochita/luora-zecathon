"use client";

import type { ReactNode } from "react";
import type { DecodedTx, OrchardLikeBundle } from "@contract/types";
import { describeFlags, proofSummary, type NodeId } from "@/lib/anatomy";
import { formatInt, formatZat, formatZec, zipUrl } from "@/lib/format";
import { feeLabel } from "@/lib/fee";
import { NODE_ICON } from "./node-icons";
import { CopyButton, ExternalLink, Hint, Inner, InnerHeader } from "./ui";

const PROTOCOL_SPEC_URL = "https://zips.z.cash/protocol/protocol.pdf";

interface Field {
  label: string;
  value: ReactNode;
  mono?: boolean;
  copy?: string;
  wrap?: boolean;
}

function Row({ field }: { field: Field }) {
  const plain = typeof field.value === "string" ? field.value : undefined;
  if (field.wrap) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5 py-1">
        <dt className="text-[13px] text-muted">{field.label}</dt>
        <dd className={`break-words text-text ${field.mono ? "font-mono text-xs" : "text-[13px]"}`}>{field.value}</dd>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3 py-1">
      <dt className="flex-none text-[13px] text-muted">{field.label}</dt>
      <dd
        className={`ml-auto min-w-0 truncate text-right text-text ${field.mono ? "font-mono text-xs" : "text-[13px]"}`}
        title={plain}
      >
        {field.value}
      </dd>
      {field.copy && <CopyButton value={field.copy} label={`Copy ${field.label}`} />}
    </div>
  );
}

function HashList({ label, hashes }: { label: string; hashes: string[] }) {
  if (hashes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] text-muted">
        {label} <span className="text-dim">{hashes.length}</span>
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {hashes.map((hash, index) => (
          <li key={`${hash}-${index}`} className="flex h-8 items-center gap-2 rounded-chip bg-raised pr-1 pl-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={hash}>
              {hash}
            </span>
            <CopyButton value={hash} label={`Copy ${label} ${index}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function orchardLikeFields(bundle: OrchardLikeBundle): Field[] {
  return [
    { label: "actions", value: formatInt(bundle.actions) },
    { label: "flags", value: describeFlags(bundle.flags), wrap: true },
    { label: "value balance", value: formatZec(bundle.valueBalanceZat, true), mono: true },
    { label: "in zatoshi", value: formatZat(bundle.valueBalanceZat), mono: true },
    { label: "anchor", value: bundle.anchor, mono: true, copy: bundle.anchor },
    { label: "Halo 2 proof", value: proofSummary(bundle.proofBytes, bundle.canonicalProofBytes), mono: true },
  ];
}

interface Section {
  title: string;
  fields: Field[];
  lists: { label: string; hashes: string[] }[];
  specs: { label: string; url: string }[];
  extra?: ReactNode;
}

function sectionFor(node: NodeId, tx: DecodedTx, feeZat: number | null): Section {
  const formatSpec =
    tx.version >= 6
      ? { label: "ZIP 229 · v6 format", url: zipUrl(229) }
      : tx.version === 5
        ? { label: "ZIP 225 · v5 format", url: zipUrl(225) }
        : { label: "Protocol spec §7.1 · v4 format", url: PROTOCOL_SPEC_URL };
  switch (node) {
    case "tx": {
      const pools = [
        tx.transparent.inputs.length + tx.transparent.outputs.length > 0 && "transparent",
        tx.sapling && tx.sapling.spends + tx.sapling.outputs > 0 && "sapling",
        tx.orchard && tx.orchard.actions > 0 && "orchard",
        tx.ironwood && tx.ironwood.actions > 0 && "ironwood",
      ].filter(Boolean);
      return {
        title: "Transaction",
        fields: [
          { label: "txid", value: tx.txid, mono: true, copy: tx.txid },
          { label: "version", value: `v${tx.version}` },
          { label: "upgrade", value: tx.upgrade ?? "not available" },
          { label: "size", value: `${formatInt(tx.sizeBytes)} bytes`, mono: true },
          { label: "pools used", value: pools.join(", ") || "none" },
        ],
        lists: [],
        specs: [tx.version >= 5 ? { label: "ZIP 244 · txid digest", url: zipUrl(244) } : formatSpec],
      };
    }
    case "header":
      return {
        title: "Header",
        fields: [
          { label: "version", value: `${tx.version}${tx.version >= 3 ? " (overwintered)" : ""}` },
          { label: "version group", value: tx.versionGroupId, mono: true },
          { label: "branch ID", value: tx.consensusBranchId ?? "not in v4 header", mono: true },
          { label: "upgrade", value: tx.upgrade ?? "not available" },
          { label: "lock time", value: formatInt(tx.lockTime), mono: true },
          { label: "expiry height", value: tx.expiryHeight === 0 ? "0 (never expires)" : formatInt(tx.expiryHeight), mono: true },
          { label: "size", value: `${formatInt(tx.sizeBytes)} bytes`, mono: true },
        ],
        lists: [],
        specs: [formatSpec, { label: "ZIP 203 · expiry", url: zipUrl(203) }],
      };
    case "transparent":
      return {
        title: "Transparent bundle",
        fields: [
          { label: "inputs", value: formatInt(tx.transparent.inputs.length) },
          { label: "outputs", value: formatInt(tx.transparent.outputs.length) },
        ],
        lists: [],
        specs: [formatSpec],
        extra: (
          <div className="flex flex-col gap-2">
            {tx.transparent.inputs.map((input, index) => (
              <Inner key={`in-${index}`} className="flex flex-col px-3 py-2">
                <p className="pb-1 text-[13px] text-text">Input {index}{input.isCoinbase ? " · coinbase" : ""}</p>
                {!input.isCoinbase && (
                  <Row field={{ label: "prevout", value: `${input.prevTxid}:${input.prevIndex}`, mono: true, copy: input.prevTxid }} />
                )}
                <Row field={{ label: "scriptSig", value: `${formatInt(input.scriptSigBytes)} bytes`, mono: true }} />
                <Row field={{ label: "sequence", value: `0x${input.sequence.toString(16).padStart(8, "0")}`, mono: true }} />
              </Inner>
            ))}
            {tx.transparent.outputs.map((output, index) => (
              <Inner key={`out-${index}`} className="flex flex-col px-3 py-2">
                <p className="pb-1 text-[13px] text-text">Output {index}</p>
                <Row field={{ label: "value", value: formatZec(output.valueZat), mono: true }} />
                {output.address && (
                  <Row
                    field={{
                      label: "address",
                      value: output.address,
                      mono: true,
                      copy: output.address,
                    }}
                  />
                )}
                <Row field={{ label: "scriptPubKey", value: output.scriptPubKey, mono: true, copy: output.scriptPubKey }} />
              </Inner>
            ))}
          </div>
        ),
      };
    case "sapling":
      if (!tx.sapling) return { title: "Sapling bundle", fields: [{ label: "status", value: "empty" }], lists: [], specs: [formatSpec] };
      return {
        title: "Sapling bundle",
        fields: [
          { label: "spends", value: formatInt(tx.sapling.spends) },
          { label: "outputs", value: formatInt(tx.sapling.outputs) },
          { label: "value balance", value: formatZec(tx.sapling.valueBalanceZat, true), mono: true },
          { label: "in zatoshi", value: formatZat(tx.sapling.valueBalanceZat), mono: true },
          ...(tx.sapling.anchor ? [{ label: "anchor", value: tx.sapling.anchor, mono: true, copy: tx.sapling.anchor }] : []),
          { label: "Groth16 proof", value: `${formatInt(tx.sapling.proofBytesEach)} B each`, mono: true },
        ],
        lists: [
          { label: "nullifiers", hashes: tx.sapling.nullifiers },
          { label: "note commitments (cmu)", hashes: tx.sapling.commitments },
        ],
        specs: [formatSpec],
      };
    case "orchard":
    case "ironwood": {
      const bundle = node === "orchard" ? tx.orchard : tx.ironwood;
      const title = node === "orchard" ? "Orchard bundle" : "Ironwood bundle";
      const specs =
        node === "orchard"
          ? [formatSpec, { label: "ZIP 257 · proof size", url: zipUrl(257) }]
          : [{ label: "ZIP 229 · v6 format", url: zipUrl(229) }, { label: "ZIP 257 · proof size", url: zipUrl(257) }];
      if (!bundle || bundle.actions === 0) {
        return {
          title,
          fields: [{ label: "status", value: node === "ironwood" && tx.version < 6 ? "only v6 transactions carry an Ironwood bundle" : "empty", wrap: true }],
          lists: [],
          specs,
        };
      }
      return {
        title,
        fields: orchardLikeFields(bundle),
        lists: [
          { label: "nullifiers", hashes: bundle.nullifiers },
          { label: "note commitments (cmx)", hashes: bundle.commitments },
        ],
        specs,
      };
    }
    case "fee": {
      const fee = feeLabel(feeZat, false, tx.transparent.inputs.some((input) => input.isCoinbase));
      return {
        title: "Fee",
        fields: [
          {
            label: "paid",
            value: fee.known ? (feeZat === null ? fee.text : `${formatZec(feeZat)} · ${formatZat(feeZat)}`) : `${fee.text}. ${fee.why}`,
            mono: feeZat !== null,
            wrap: feeZat === null,
          },
          { label: "logical actions", value: formatInt(tx.zip317.logicalActions), mono: true },
          {
            label: "conventional",
            value: `${formatZec(tx.zip317.conventionalFeeZat)} · ${formatZat(tx.zip317.conventionalFeeZat)}`,
            mono: true,
          },
          { label: "formula", value: "transparent in − out + Σ shielded value balances", wrap: true },
        ],
        lists: [],
        specs: [{ label: "ZIP 317 · conventional fee", url: zipUrl(317) }],
      };
    }
  }
}

export function NodeInspector({ node, tx, feeZat }: { node: NodeId; tx: DecodedTx; feeZat: number | null }) {
  const section = sectionFor(node, tx, feeZat);
  const Icon = NODE_ICON[node];
  return (
    <div className="flex flex-col gap-3">
      <Inner className="flex flex-col px-3 py-2.5">
        <InnerHeader icon={<Icon />}>{section.title}</InnerHeader>
        <dl className="mt-1.5 flex flex-col">
          {section.fields.map((field) => (
            <Row key={field.label} field={field} />
          ))}
        </dl>
      </Inner>
      {section.extra}
      {section.lists.map((list) => (
        <HashList key={list.label} label={list.label} hashes={list.hashes} />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span>Spec</span>
        {section.specs.map((spec) => (
          <ExternalLink key={spec.url + spec.label} href={spec.url}>
            {spec.label}
          </ExternalLink>
        ))}
      </div>
      <Hint>
        Only public fields are shown. Shielded amounts, senders, recipients and memos stay encrypted; Luora never asks for a
        viewing key to draw this.
      </Hint>
    </div>
  );
}
