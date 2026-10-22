"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Network } from "@contract/types";
import type { ChainInfo } from "@/lib/api";
import { formatInt, NETWORK_LABEL } from "@/lib/format";
import { BrandLogo } from "./brand";
import { Chip } from "./ui";

export type ChainState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChainInfo };

export function TopBar({ network, chain, onHome, aside }: { network: Network; chain: ChainState; onHome: () => void; aside?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 pt-4 pb-3">
      <Link
        href="/"
        onClick={onHome}
        aria-label="Luora home"
        className="ml-1 flex items-center rounded-tile p-0.5 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/25"
      >
        <BrandLogo />
      </Link>
      <div className="ml-auto flex items-center gap-3">
        {aside}
        {chain.status === "ready" ? (
          <Chip tone="ok" dot title={`${chain.data.upgrade} active · tip from ${chain.data.endpoint}`}>
            {NETWORK_LABEL[network]} · <span className="font-mono text-xs">{formatInt(chain.data.height)}</span>
          </Chip>
        ) : chain.status === "error" ? (
          <Chip tone="warn" dot title={chain.message}>
            {NETWORK_LABEL[network]} · tip not available
          </Chip>
        ) : (
          <span className="skeleton h-6 w-36 rounded-chip" role="status" aria-label={`${NETWORK_LABEL[network]} tip loading`} />
        )}
        <Link href="/about" className="link text-[13px]">
          About
        </Link>
      </div>
    </header>
  );
}
