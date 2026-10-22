"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { api, errorText, type BackendComparison } from "@/lib/api";
import { nodeName, statusText, type BackendReport, type BackendStatus } from "@/lib/diverge";
import { formatInt, NETWORK_LABEL, shortHash } from "@/lib/format";
import { Button, Chip, CopyButton, Hint, Panel, Tabs, type Tone } from "./ui";

type WatchedNetwork = "main" | "test";

const REFRESH_MS = 30_000;

const STATUS_TONE: Record<BackendStatus, Tone> = { agree: "ok", lagging: "warn", diverged: "bad", unreachable: "neutral" };

type State = { status: "loading" } | { status: "error"; message: string; key: string } | { status: "ready"; data: BackendComparison; key: string };

function summary(data: BackendComparison): { tone: Tone; text: string } {
  const diverged = data.backends.filter((each) => each.status === "diverged").length;
  const reachable = data.backends.filter((each) => each.status !== "unreachable").length;
  if (!data.reference) return { tone: "bad", text: "No backend answered." };
  if (diverged) {
    return { tone: "bad", text: `${diverged} of ${reachable} reachable backends follow a different chain than ${data.reference}.` };
  }
  return { tone: "ok", text: `All ${reachable} reachable backends are on one chain; the highest tip is ${formatInt(data.tipHeight!)}.` };
}

function HashLine({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-28 flex-none text-dim">{label}</span>
      <span className="truncate font-mono text-xs text-text" title={hash}>
        {hash}
      </span>
      <CopyButton value={hash} label={`Copy ${label} hash`} />
    </div>
  );
}

function BackendRow({ report, target, reference }: { report: BackendReport; target: string; reference: string }) {
  const node = report.info && nodeName(report.info);
  return (
    <div className="flex flex-col gap-2 rounded-inner border border-border bg-inner-grad p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium text-fg">{report.label}</span>
        <span className="font-mono text-xs text-dim">{target}</span>
        {report.reference && <Chip>reference</Chip>}
        <Chip tone={STATUS_TONE[report.status]} dot className="ml-auto">
          {statusText(report)}
        </Chip>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
        {report.info && (
          <span>
            {report.info.vendor} {report.info.version}
            {node ? ` · ${node}` : " · node not reported"}
          </span>
        )}
        {report.tipHeight !== null && (
          <span>
            tip <span className="font-mono text-xs text-text">{formatInt(report.tipHeight)}</span>{" "}
            <span className="font-mono text-xs" title={report.tipHash ?? undefined}>
              {shortHash(report.tipHash ?? "")}
            </span>
          </span>
        )}
        {report.latencyMs !== null && <span>{formatInt(report.latencyMs)} ms</span>}
        {report.calls > 0 && <span>{report.calls} block lookups</span>}
      </div>
      {report.error && <Hint>{report.error}</Hint>}
      {report.fork && (
        <div className="flex flex-col gap-1 rounded-tile bg-inset p-2.5 text-[12.5px]">
          <span className="text-muted">
            Block {formatInt(report.fork.height)}
            {report.fork.exact ? " is the first height where the hashes differ" : " still differs; the first differing height was not pinned down"}
          </span>
          <HashLine label={reference} hash={report.fork.referenceHash} />
          <HashLine label={report.label} hash={report.fork.hash} />
        </div>
      )}
    </div>
  );
}

export function ChainWatch() {
  const [network, setNetwork] = useState<WatchedNetwork>("main");
  const [state, setState] = useState<State>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const key = `${network}:${tick}`;
  const refreshing = state.status === "loading" || state.key !== key;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${network}:${tick}`;
    api
      .compare(network, controller.signal)
      .then((data) => setState({ status: "ready", data, key }))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState({ status: "error", message: errorText(error), key });
      });
    const timer = setTimeout(refresh, REFRESH_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [network, tick, refresh]);

  const changeNetwork = (next: WatchedNetwork) => {
    setNetwork(next);
    setState({ status: "loading" });
  };

  const data = state.status === "ready" && state.data.network === network ? state.data : null;
  const headline = data && summary(data);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <Tabs
          label="Network"
          value={network}
          onChange={changeNetwork}
          options={(["main", "test"] as const).map((value) => ({ value, label: NETWORK_LABEL[value] }))}
        />
        <Button size="sm" className="ml-auto" onClick={refresh} disabled={refreshing}>
          <ArrowClockwise className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>
      <Panel
        label={headline ? headline.text : state.status === "error" ? "Comparison failed" : "Asking every backend"}
        dot={headline ? headline.tone : state.status === "error" ? "bad" : "neutral"}
        aside={data && <span>checked {new Date(data.fetchedAt).toLocaleTimeString()} · every 30 s</span>}
        bodyClassName="gap-2 px-4 pb-4"
      >
        {state.status === "error" && <Hint>{state.message}</Hint>}
        {!data && state.status === "loading" &&
          Array.from({ length: 4 }, (_, index) => <span key={index} className="skeleton h-[76px] rounded-inner" />)}
        {data?.backends.map((report) => (
          <BackendRow key={report.label} report={report} target={data.targets[report.label] ?? ""} reference={data.reference ?? ""} />
        ))}
      </Panel>
    </div>
  );
}
