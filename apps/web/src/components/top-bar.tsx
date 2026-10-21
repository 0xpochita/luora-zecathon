"use client";

import Link from "next/link";
import type { Network } from "@contract/types";
import type { ChainInfo } from "@/lib/api";
import { formatInt, NETWORK_LABEL } from "@/lib/format";
import { Chip, LogoMark } from "./ui";

export type ChainState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChainInfo };

export function TopBar({ network, chain, onHome }: { network: Network; chain: ChainState; onHome: () => void }) {
  return (
    <header className="flex items-center gap-2 px-4 pt-4 pb-3">
      <Link
        href="/"
        onClick={onHome}
        aria-label="luora z home"
        className="ml-1 flex items-center gap-2.5 rounded-tile text-[15px] font-medium outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/25"
      >
        <LogoMark />
        <span>
          luora <span className="text-muted">z</span>
        </span>
      </Link>
      <div className="ml-auto flex items-center gap-3">
        {chain.status === "ready" ? (
          <Chip tone="ok" dot title={`${chain.data.upgrade} active · tip from ${chain.data.endpoint}`}>
            {NETWORK_LABEL[network]} · <span className="font-mono text-xs">{formatInt(chain.data.height)}</span>
          </Chip>
        ) : chain.status === "error" ? (
          <Chip tone="warn" dot title={chain.message}>
            {NETWORK_LABEL[network]} · tip not available
          </Chip>
        ) : (
          <Chip dot>{NETWORK_LABEL[network]} · loading…</Chip>
        )}
        <Link href="/about" className="link text-[13px]">
          About
        </Link>
      </div>
    </header>
  );
}
