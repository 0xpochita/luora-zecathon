"use client";

import Link from "next/link";
import { Info } from "@phosphor-icons/react";
import type { Network } from "@contract/types";
import type { ChainInfo } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { Chip, Input, LogoMark, SegmentedControl, tile, Toolbar } from "./ui";

export type ChainState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChainInfo };

export function TopBar({
  network,
  onNetworkChange,
  heightText,
  onHeightChange,
  heightInvalid,
  chain,
  chosenHeight,
  upgradeName,
}: {
  network: Network;
  onNetworkChange: (network: Network) => void;
  heightText: string;
  onHeightChange: (value: string) => void;
  heightInvalid: boolean;
  chain: ChainState;
  chosenHeight: number | null;
  upgradeName: string | null;
}) {
  const live = chain.status === "ready" ? chain.data : null;
  const followingLive = heightText.trim() === "";
  return (
    <header className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
      <Link
        href="/"
        aria-label="luora z home"
        className="mr-2 ml-1 flex items-center gap-2.5 rounded-tile text-[15px] font-medium outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/25"
      >
        <LogoMark />
        <span>
          luora <span className="text-muted">z</span>
        </span>
      </Link>
      <Toolbar label="Network and height" className="flex-wrap">
        <SegmentedControl
          label="Network"
          value={network === "test" ? "test" : "main"}
          onChange={onNetworkChange}
          options={[
            { value: "main", label: "Mainnet" },
            { value: "test", label: "Testnet" },
          ]}
        />
        <label htmlFor="check-height" className="pl-1.5 text-[13px] text-muted">
          at height
        </label>
        <Input
          id="check-height"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={heightText}
          onChange={(event) => onHeightChange(event.target.value)}
          placeholder={live ? formatInt(live.height) : chain.status === "loading" ? "loading…" : "type a height"}
          aria-invalid={heightInvalid}
          aria-describedby="height-status"
          className={`h-8 w-[132px] font-mono text-xs ${heightInvalid ? "border-red/60" : ""}`}
        />
        <span id="height-status" className="pr-1">
          {heightInvalid ? (
            <Chip tone="bad" dot>
              not a height
            </Chip>
          ) : chain.status === "error" && followingLive ? (
            <Chip tone="warn" dot title={chain.message}>
              live height not available
            </Chip>
          ) : chain.status === "loading" && followingLive ? (
            <Chip dot>loading tip…</Chip>
          ) : (
            <Chip tone={followingLive ? "ok" : "neutral"} dot title={live ? `tip ${formatInt(live.height)} from ${live.endpoint}` : undefined}>
              {upgradeName ? `${upgradeName} active` : "upgrade not available"}
              {followingLive ? " · live tip" : chosenHeight !== null && live && chosenHeight > live.height ? " · future" : ""}
            </Chip>
          )}
        </span>
      </Toolbar>
      <div className="ml-auto flex items-center gap-2">
        <Chip tone="ok" dot title="Hex and PCZTs are decoded in this tab with WebAssembly; they are never sent anywhere.">
          Runs locally
        </Chip>
        <Link href="/about" aria-label="About luora z" title="About luora z" className={`${tile(false)} size-8 text-[14px]`}>
          <Info />
        </Link>
      </div>
    </header>
  );
}
