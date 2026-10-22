import type { CheckStatus } from "@contract/types";

export interface StallPoint {
  line: number;
  at: number | null;
  height: number;
  percent: number | null;
  remaining: number | null;
  sinceLastBlock: string | null;
}

export interface StallMarker {
  line: number;
  at: number | null;
  kind: "restart" | "timeout" | "warn" | "error";
  text: string;
}

export interface StallLink {
  label: string;
  url: string;
}

export interface StallCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  evidence: string[];
  workaround: string;
  links: StallLink[];
  verified: boolean;
}

export interface ChainInfo {
  blocks: number;
  estimatedHeight: number | null;
}

export interface StallReport {
  lineCount: number;
  points: StallPoint[];
  markers: StallMarker[];
  metrics: Map<string, number>;
  metricCount: number;
  chainInfo: ChainInfo | null;
  checks: StallCheck[];
}

interface Line {
  n: number;
  text: string;
  at: number | null;
  level: string | null;
}

const ZEBRA = "https://github.com/ZcashFoundation/zebra";
const ANSI = /\x1b\[[0-9;]*m/g;
const TIMESTAMP = /\b(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/;
const LEVEL = /\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/;
const LEADING_LEVEL = /^\s*(TRACE|DEBUG|INFO|WARN|ERROR)\b/;
const METRIC = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)/;
const MAX_EVIDENCE = 8;
const CHECKPOINT_GAP_LIMIT = 800;
const LOW_PEERS = 5;
const STALL_MS = 10 * 60 * 1000;

const PATTERNS = {
  parent: /state must contain parent block to do contextual validation|NotReadyToBeCommitted|block parent not found in any chain/,
  behindTip: /queued download of hash behind our chain tip/,
  timeout: /Elapsed\(|\btimed out\b|BlockDownloadVerifyError::Timeout|\bTimeout\b/,
  notFound: /NotFoundRegistry|NotFoundResponse|recently missing these items|no (busy )?peer that might have the inventory/,
  downcast: /downcast to known transaction error type failed/,
  stalled: /chain updates have stalled, state height has not increased/,
  slowSync: /initial sync is very slow/,
  tcp: /tcp_slow_start_after_idle|TCP slow-start-after-idle/,
  restart: /Starting zebrad|Thank you for running a \w+ zebrad/,
};

function issueUrl(number: number): string {
  return `${ZEBRA}/issues/${number}`;
}

function pullUrl(number: number): string {
  return `${ZEBRA}/pull/${number}`;
}

export function looksLikeNodeOutput(raw: string): boolean {
  const text = raw.replace(ANSI, "");
  if (/^# (TYPE|HELP) [a-zA-Z_:]/m.test(text)) return true;
  if (parseChainInfo(text)) return true;
  const logLines = text.split(/\r?\n/).filter((line) => (TIMESTAMP.test(line) && LEVEL.test(line)) || LEADING_LEVEL.test(line));
  return logLines.length >= 2;
}

function parseTime(text: string): number | null {
  const match = text.match(TIMESTAMP);
  if (!match) return null;
  const fraction = match[3] ? match[3].slice(0, 4) : "";
  const zone = match[4] ?? "Z";
  const at = Date.parse(`${match[1]}T${match[2]}${fraction}${zone}`);
  return Number.isNaN(at) ? null : at;
}

function parseChainInfo(text: string): ChainInfo | null {
  const start = text.search(/^\s*\{/m);
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const body = parsed && typeof parsed.result === "object" && parsed.result ? parsed.result : parsed;
    if (typeof body?.blocks !== "number" || !("bestblockhash" in body || "chain" in body)) return null;
    return { blocks: body.blocks, estimatedHeight: typeof body.estimatedheight === "number" ? body.estimatedheight : null };
  } catch {
    return null;
  }
}

function parseMetrics(lines: Line[]): Map<string, number> {
  const metrics = new Map<string, number>();
  for (const line of lines) {
    if (line.at !== null || line.text.startsWith("#")) continue;
    const match = line.text.trim().match(METRIC);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const name = match[1].replace(/_total$/, "");
    metrics.set(name, (metrics.get(name) ?? 0) + value);
  }
  return metrics;
}

function parsePoint(line: Line): StallPoint | null {
  const height = line.text.match(/current_height=(?:Height\()?(\d+)/);
  if (!height) return null;
  const percent = line.text.match(/sync_percent=([\d.]+)%/);
  const remaining = line.text.match(/remaining_sync_blocks=(\d+)/);
  const since = line.text.match(/time_since_last_state_block=(.+?)(?=\s+\w+=|$)/);
  return {
    line: line.n,
    at: line.at,
    height: Number(height[1]),
    percent: percent ? Number(percent[1]) : null,
    remaining: remaining ? Number(remaining[1]) : null,
    sinceLastBlock: since ? since[1].trim() : null,
  };
}

function markerKind(line: Line): StallMarker["kind"] | null {
  if (PATTERNS.restart.test(line.text)) return "restart";
  if (PATTERNS.timeout.test(line.text) && (line.level === "WARN" || line.level === "ERROR" || line.level === null)) return "timeout";
  if (line.level === "ERROR") return "error";
  if (line.level === "WARN") return "warn";
  return null;
}

function shorten(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 320 ? `${trimmed.slice(0, 319)}…` : trimmed;
}

function evidence(lines: Line[]): string[] {
  const shown = lines.slice(0, MAX_EVIDENCE).map((line) => `${line.n}: ${shorten(line.text)}`);
  return lines.length > MAX_EVIDENCE ? [...shown, `… and ${lines.length - MAX_EVIDENCE} more`] : shown;
}

function matching(lines: Line[], pattern: RegExp): Line[] {
  return lines.filter((line) => pattern.test(line.text));
}

function flatSpan(points: StallPoint[]): StallPoint[] | null {
  const last = points.at(-1);
  if (!last || last.at === null) return null;
  const flat = [];
  for (let index = points.length - 1; index >= 0 && points[index].height === last.height; index -= 1) flat.unshift(points[index]);
  const first = flat[0];
  return first.at !== null && last.at - first.at >= STALL_MS ? flat : null;
}

export function diagnoseStall(raw: string): StallReport {
  const lines: Line[] = raw
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((text, index) => ({ n: index + 1, text, at: parseTime(text), level: text.match(LEVEL)?.[1] ?? null }))
    .filter((line) => line.text.trim() !== "");
  const metrics = parseMetrics(lines);
  const chainInfo = parseChainInfo(raw);
  const points = lines.flatMap((line) => {
    const point = parsePoint(line);
    return point ? [point] : [];
  });
  const markers = lines.flatMap((line): StallMarker[] => {
    const kind = line.level === null && line.at === null && !PATTERNS.restart.test(line.text) ? null : markerKind(line);
    return kind ? [{ line: line.n, at: line.at, kind, text: shorten(line.text) }] : [];
  });

  const checks: StallCheck[] = [];
  const metric = (name: string) => metrics.get(name) ?? null;

  const parent = matching(lines, PATTERNS.parent);
  const chainCount = metric("state_memory_chain_count");
  const forksFull = chainCount !== null && chainCount >= 10;
  checks.push({
    id: "parent-missing",
    title: "Stuck on a losing fork: parent block missing",
    status: parent.length >= 3 || (parent.length > 0 && forksFull) ? "fail" : parent.length > 0 || forksFull ? "warn" : "pass",
    detail:
      "Zebra keeps up to 10 side chains in memory on Mainnet. When they are all full of a losing branch, new blocks whose parent was dropped are refused with “state must contain parent block to do contextual validation” (NotReadyToBeCommitted) again and again, and the height stops moving." +
      (chainCount !== null ? ` Non-finalized chain count from metrics: ${chainCount}.` : ""),
    evidence: [...evidence(parent), ...(chainCount !== null ? [`metric state_memory_chain_count ${chainCount}`] : [])],
    workaround: "Update to a Zebra release that includes PR #11582. Until then, restarting zebrad usually drops the stale in-memory forks.",
    links: [
      { label: "Issue #11133", url: issueUrl(11133) },
      { label: "Fix PR #11582", url: pullUrl(11582) },
    ],
    verified: true,
  });

  const timeouts = markers.filter((marker) => marker.kind === "timeout");
  const behind = matching(lines, PATTERNS.behindTip);
  const behindAfterTimeout = behind.filter((line) => timeouts.some((marker) => marker.line < line.n));
  checks.push({
    id: "behind-tip",
    title: "Sync loop re-queues blocks behind the tip after a timeout",
    status: behindAfterTimeout.length > 0 ? "fail" : behind.length > 0 ? "warn" : "pass",
    detail:
      "After a block verify timeout the syncer restarts and can keep asking for hashes it already has, failing each round with “queued download of hash behind our chain tip” instead of moving forward.",
    evidence: evidence(behindAfterTimeout.length > 0 ? behindAfterTimeout : behind),
    workaround: "Update to a Zebra release that includes PR #11510. A restart of zebrad gets the syncer going again in the meantime.",
    links: [
      { label: "Issue #11509", url: issueUrl(11509) },
      { label: "Fix PR #11510", url: pullUrl(11510) },
    ],
    verified: true,
  });

  const notFound = matching(lines, PATTERNS.notFound);
  const refusals = metric("zcash_net_peer_set_inventory_refusal");
  const nearTip = points.some((point) => (point.percent ?? 0) >= 99);
  const refused = notFound.length > 0 || (refusals !== null && refusals > 0);
  checks.push({
    id: "verify-timeout-near-tip",
    title: "Block verify timeouts near the tip with refused requests",
    status: timeouts.length > 0 && refused ? "fail" : timeouts.length > 0 ? "warn" : "pass",
    detail:
      "Zebra gives each block 8 minutes to download and verify. Near the tip, requests for missing blocks can be refused while the peers that have them are busy (NotFoundRegistry), so blocks time out and sync restarts without progress." +
      (nearTip ? " The progress lines show the node above 99%." : ""),
    evidence: [
      ...evidence(lines.filter((line) => timeouts.some((marker) => marker.line === line.n) || notFound.includes(line))),
      ...(refusals !== null ? [`metric zcash_net_peer_set_inventory_refusal ${refusals}`] : []),
    ],
    workaround: "Lower the number of concurrent block downloads: set download_concurrency_limit = 5 in the [sync] section of zebrad.toml and restart.",
    links: [{ label: "Issue #11610 (open)", url: issueUrl(11610) }],
    verified: true,
  });

  const downcast = matching(lines, PATTERNS.downcast);
  const downcastElapsed = downcast.filter((line) => line.text.includes("Elapsed"));
  checks.push({
    id: "downcast-elapsed",
    title: "Timeout misreported as an invalid transaction",
    status: downcastElapsed.length > 0 ? "fail" : downcast.length > 0 ? "warn" : "pass",
    detail:
      "InternalDowncastError(“downcast to known transaction error type failed, original error: Elapsed(())”) is a timeout while waiting for a spent output, not a bad transaction. A regression from PR #10494 turned it into a block verification failure, so the node keeps rejecting valid blocks and stalls.",
    evidence: evidence(downcastElapsed.length > 0 ? downcastElapsed : downcast),
    workaround: "Update to a Zebra release that includes PRs #10630 and #10633.",
    links: [
      { label: "Regression PR #10494", url: pullUrl(10494) },
      { label: "Fix PR #10630", url: pullUrl(10630) },
      { label: "Fix PR #10633", url: pullUrl(10633) },
      { label: "Forum: zebrad stalling", url: "https://forum.zcashcommunity.com/t/zebrad-stalling/55819" },
    ],
    verified: true,
  });

  const stalled = matching(lines, PATTERNS.stalled);
  const slow = matching(lines, PATTERNS.slowSync);
  const flat = flatSpan(points);
  const behindChain = chainInfo?.estimatedHeight != null ? chainInfo.estimatedHeight - chainInfo.blocks : null;
  checks.push({
    id: "chain-stalled",
    title: "Chain updates have stalled",
    status: stalled.length > 0 ? "fail" : flat || slow.length > 0 || (behindChain !== null && behindChain > 10) ? "warn" : "pass",
    detail:
      "Zebra warns when the state height has not increased for 10 minutes. Without a more specific signature above, the usual causes are no useful peers, a blocked network connection, or a wrong system clock or time zone." +
      (flat ? ` Height stayed at ${flat[0].height} for ${flat.length} progress lines.` : "") +
      (behindChain !== null ? ` getblockchaininfo: ${chainInfo!.blocks} blocks, estimated tip ${chainInfo!.estimatedHeight}.` : ""),
    evidence: [
      ...evidence([...stalled, ...slow]),
      ...(flat ? [`lines ${flat[0].line}–${flat.at(-1)!.line}: current_height stays ${flat[0].height}`] : []),
    ],
    workaround: "Check the peer count, that port 8233 (Mainnet) is reachable, and that the system clock is synced (NTP) with the right time zone. Then restart zebrad.",
    links: [{ label: "Zebra book: troubleshooting", url: "https://zebra.zfnd.org/user/troubleshooting.html" }],
    verified: true,
  });

  const tcp = matching(lines, PATTERNS.tcp);
  checks.push({
    id: "tcp-slow-start",
    title: "Linux TCP slow start after idle is on",
    status: tcp.length > 0 ? "warn" : "pass",
    detail:
      "Zebra warns at startup on Linux when net.ipv4.tcp_slow_start_after_idle is enabled: the TCP window resets between block requests, which cuts single-peer throughput and slows block propagation.",
    evidence: evidence(tcp),
    workaround: "Run sysctl -w net.ipv4.tcp_slow_start_after_idle=0, and persist it in /etc/sysctl.d/.",
    links: [{ label: "Zebra book: Linux TCP tuning", url: "https://zebra.zfnd.org/user/troubleshooting.html#linux-tcp-tuning-for-block-propagation" }],
    verified: true,
  });

  const queued = metric("checkpoint_queued_continuous_height");
  const verifiedHeight = metric("checkpoint_verified_height");
  const gap = queued !== null && verifiedHeight !== null ? queued - verifiedHeight : null;
  checks.push({
    id: "checkpoint-gap",
    title: "Checkpoint verifier falling behind its queue",
    status: gap === null ? "na" : gap > CHECKPOINT_GAP_LIMIT ? "warn" : "pass",
    detail:
      gap === null
        ? "Needs checkpoint_queued_continuous_height and checkpoint_verified_height from /metrics."
        : `Blocks are queued up to ${queued} but checkpoint-verified only to ${verifiedHeight}, a gap of ${gap}. A gap that keeps growing means downloads arrive but checkpoint verification is not keeping up or is waiting on a missing block.`,
    evidence: gap === null ? [] : [`metric checkpoint_queued_continuous_height ${queued}`, `metric checkpoint_verified_height ${verifiedHeight}`],
    workaround: "Compare two /metrics snapshots a few minutes apart. If the gap grows, lower checkpoint_verify_concurrency_limit in [sync] and check disk I/O.",
    links: [{ label: "Zebra book: troubleshooting", url: "https://zebra.zfnd.org/user/troubleshooting.html" }],
    verified: false,
  });

  const peers = metric("zcash_net_peers");
  checks.push({
    id: "low-peers",
    title: "Low peer count",
    status: peers === null ? "na" : peers === 0 ? "fail" : peers < LOW_PEERS ? "warn" : "pass",
    detail: peers === null ? "Needs zcash_net_peers from /metrics." : `Connected to ${peers} peer${peers === 1 ? "" : "s"}. With only a few peers, one slow or lying peer can hold back the whole sync.`,
    evidence: peers === null ? [] : [`metric zcash_net_peers ${peers}`],
    workaround: "Open inbound port 8233 (Mainnet) or 18233 (Testnet), check DNS seeders resolve, and add known peers to initial_mainnet_peers in [network].",
    links: [{ label: "Zebra book: troubleshooting", url: "https://zebra.zfnd.org/user/troubleshooting.html" }],
    verified: false,
  });

  return { lineCount: lines.length, points, markers, metrics, metricCount: metrics.size, chainInfo, checks };
}

export const STALL_NEXT = [
  {
    title: "Metrics",
    detail: "enable the Prometheus endpoint (zebrad built with the prometheus feature) and paste /metrics here",
    config: '[metrics] endpoint_addr = "127.0.0.1:9999"',
  },
  {
    title: "Health",
    detail: "/ready says whether the node is near the tip with enough peers, /healthy whether it is up",
    config: '[health] listen_addr = "127.0.0.1:8080"',
  },
  {
    title: "Tracing filter",
    detail: "raise log detail at runtime without a restart, e.g. POST zebrad::components::sync=debug to /filter",
    config: '[tracing] endpoint_addr = "127.0.0.1:3000"',
  },
  {
    title: "Chain info",
    detail: "paste the getblockchaininfo JSON from the RPC to compare the local height with the estimated tip",
    config: null,
  },
];
