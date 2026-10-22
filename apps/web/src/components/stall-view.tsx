"use client";

import { CaretRight, Stethoscope } from "@phosphor-icons/react";
import type { CheckStatus } from "@contract/types";
import { STALL_NEXT, type StallCheck, type StallMarker, type StallPoint, type StallReport } from "@/lib/stall";
import { formatInt } from "@/lib/format";
import { Chip, Dot, EmptyState, ExternalLink, Hint, Inner, STATUS_TONE } from "./ui";

const ORDER: CheckStatus[] = ["fail", "warn", "pass", "na"];
const STALL_LABEL: Record<CheckStatus, string> = { fail: "Hit", warn: "Maybe", pass: "Not seen", na: "No data" };
const MARKER_COLOR: Record<StallMarker["kind"], string> = {
  restart: "var(--blue)",
  timeout: "var(--red)",
  error: "var(--red)",
  warn: "var(--yellow)",
};
const MARKER_LABEL: Record<StallMarker["kind"], string> = { restart: "restart", timeout: "verify timeout", error: "error", warn: "warning" };
const MARKER_TONE = { restart: "info", timeout: "bad", error: "bad", warn: "warn" } as const;

const W = 640;
const H = 180;
const PAD = { left: 64, right: 12, top: 12, bottom: 34 };

function timeLabel(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

function Timeline({ points, markers: allMarkers }: { points: StallPoint[]; markers: StallMarker[] }) {
  const timed = points.every((point) => point.at !== null);
  const markers = timed ? allMarkers.filter((marker) => marker.at !== null) : allMarkers;
  const xOf = (item: { at: number | null; line: number }) => (timed ? item.at! : item.line);
  const xs = [...points.map(xOf), ...markers.map(xOf)];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const heights = points.map((point) => point.height);
  const y0 = Math.min(...heights);
  const y1 = Math.max(...heights);
  const sx = (value: number) => PAD.left + ((value - x0) / Math.max(x1 - x0, 1)) * (W - PAD.left - PAD.right);
  const sy = (value: number) => H - PAD.bottom - ((value - y0) / Math.max(y1 - y0, 1)) * (H - PAD.top - PAD.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${sx(xOf(point)).toFixed(1)},${sy(point.height).toFixed(1)}`).join(" ");
  const kinds = [...new Set(markers.map((marker) => marker.kind))];
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Height from ${formatInt(y0)} to ${formatInt(y1)} over ${points.length} progress lines, ${markers.length} markers`}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border-strong)" />
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} stroke="var(--border)" strokeDasharray="2 4" />
        <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="font-mono">
          {formatInt(y1)}
        </text>
        <text x={PAD.left - 8} y={H - PAD.bottom + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="font-mono">
          {formatInt(y0)}
        </text>
        <text x={PAD.left} y={H - 10} fontSize="11" fill="var(--dim)" className="font-mono">
          {timed ? timeLabel(x0) : `line ${x0}`}
        </text>
        <text x={W - PAD.right} y={H - 10} textAnchor="end" fontSize="11" fill="var(--dim)" className="font-mono">
          {timed ? timeLabel(x1) : `line ${x1}`}
        </text>
        {markers.map((marker, index) => (
          <g key={index}>
            <title>{`${MARKER_LABEL[marker.kind]} · line ${marker.line}: ${marker.text}`}</title>
            <line x1={sx(xOf(marker))} x2={sx(xOf(marker))} y1={PAD.top} y2={H - PAD.bottom} stroke={MARKER_COLOR[marker.kind]} strokeOpacity="0.55" strokeDasharray="3 3" />
            <rect x={sx(xOf(marker)) - 6} y={PAD.top} width="12" height={H - PAD.top - PAD.bottom} fill="transparent" />
            <circle cx={sx(xOf(marker))} cy={H - PAD.bottom} r="4" fill={MARKER_COLOR[marker.kind]} stroke="var(--surface)" strokeWidth="2" />
          </g>
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" />}
        {points.map((point, index) => (
          <g key={index}>
            <title>{`${formatInt(point.height)}${point.percent !== null ? ` · ${point.percent}%` : ""}${point.at !== null ? ` · ${timeLabel(point.at)}` : ""}${point.sinceLastBlock ? ` · ${point.sinceLastBlock} since last block` : ""}`}</title>
            <circle cx={sx(xOf(point))} cy={sy(point.height)} r="8" fill="transparent" />
            <circle cx={sx(xOf(point))} cy={sy(point.height)} r="3" fill="var(--fg)" stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12.5px] text-dim">
        <span>Height {timed ? "over time (UTC)" : "by log line"}</span>
        {kinds.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <Dot tone={MARKER_TONE[kind]} />
            {MARKER_LABEL[kind]} ({markers.filter((marker) => marker.kind === kind).length})
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function StallRow({ check }: { check: StallCheck }) {
  return (
    <Inner className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5">
      <span className="inline-flex w-16 flex-none items-center gap-1.5 self-start pt-px text-[12.5px] text-muted">
        <Dot tone={STATUS_TONE[check.status]} />
        {STALL_LABEL[check.status]}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-fg">{check.title}</p>
          {!check.verified && <Chip title="The metric names are from Zebra's source; the threshold is ours and not confirmed by Zebra">unverified threshold</Chip>}
        </div>
        <p className="text-[13px] leading-relaxed text-body">{check.detail}</p>
        {check.evidence.length > 0 && (
          <details className="group">
            <summary className="inline-flex list-none items-center gap-1 rounded-chip text-[12.5px] text-dim outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-overlay/25 [&::-webkit-details-marker]:hidden">
              {check.evidence.length} evidence line{check.evidence.length === 1 ? "" : "s"}
              <CaretRight className="transition-transform group-open:rotate-90" />
            </summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-tile bg-inset px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-muted">
              {check.evidence.join("\n")}
            </pre>
          </details>
        )}
        {check.status !== "pass" && check.status !== "na" && (
          <p className="text-[13px] leading-relaxed text-body">
            <span className="text-muted">Workaround: </span>
            {check.workaround}
          </p>
        )}
        {check.links.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
            {check.links.map((link) => (
              <ExternalLink key={link.url} href={link.url}>
                {link.label}
              </ExternalLink>
            ))}
          </div>
        )}
      </div>
    </Inner>
  );
}

export function StallView({ report }: { report: StallReport }) {
  const sorted = [...report.checks].sort((left, right) => ORDER.indexOf(left.status) - ORDER.indexOf(right.status));
  const attention = sorted.filter((check) => check.status === "fail" || check.status === "warn");
  const rest = sorted.filter((check) => check.status === "pass" || check.status === "na");
  const last = report.points.at(-1);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-dim">
        <Chip>{formatInt(report.lineCount)} lines</Chip>
        {report.points.length > 0 && <Chip>{report.points.length} progress lines</Chip>}
        {report.metricCount > 0 && <Chip>{report.metricCount} metrics</Chip>}
        {report.chainInfo && <Chip>getblockchaininfo</Chip>}
        {last && (
          <Chip>
            last height {formatInt(last.height)}
            {last.percent !== null ? ` · ${last.percent}%` : ""}
          </Chip>
        )}
      </div>
      {report.points.length > 0 ? (
        <Inner className="p-3">
          <Timeline points={report.points} markers={report.markers} />
        </Inner>
      ) : (
        <EmptyState icon={<Stethoscope />} title="No sync progress lines">
          The timeline needs lines containing <span className="font-mono text-xs">estimated progress to chain tip</span> with a{" "}
          <span className="font-mono text-xs">current_height</span>. They are logged at INFO about once a minute.
        </EmptyState>
      )}
      <div className="flex flex-col gap-1.5">
        {attention.length === 0 && (
          <Inner className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-body">
            <Dot tone="ok" />
            None of the known stall signatures appear in this input.
          </Inner>
        )}
        {attention.map((check) => (
          <StallRow key={check.id} check={check} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="group flex flex-col gap-1.5">
          <summary className="flex h-9 list-none items-center gap-2 rounded-tile bg-raised px-3 text-[13px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-overlay/25 [&::-webkit-details-marker]:hidden">
            <Dot tone="ok" />
            {rest.length} signature{rest.length === 1 ? "" : "s"} not seen or without data
            <CaretRight className="ml-auto text-muted transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {rest.map((check) => (
              <StallRow key={check.id} check={check} />
            ))}
          </div>
        </details>
      )}
      <Inner className="flex flex-col gap-1.5 px-3 py-2.5">
        <p className="text-[13px] font-medium text-fg">What to collect next</p>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed text-body">
          {STALL_NEXT.map((item) => (
            <li key={item.title}>
              <span className="text-fg">{item.title}</span>: {item.detail}{" "}
              {item.config && <span className="font-mono text-xs text-port">{item.config}</span>}
            </li>
          ))}
        </ul>
      </Inner>
      <Hint>Matched in this tab against known Zebra stall reports. Nothing you paste leaves the browser.</Hint>
    </div>
  );
}
