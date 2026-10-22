"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Network } from "@contract/types";
import type { ChainInfo } from "@/lib/api";
import { formatInt, NETWORK_LABEL } from "@/lib/format";
import { BrandLogo } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { Chip } from "./ui";

export type ChainState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChainInfo };

export function TopBar({ network, chain, onHome, aside }: { network: Network; chain: ChainState; onHome: () => void; aside?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 pt-4 pb-3">
      <Link
        href="/"
        onClick={onHome}
        aria-label="Luora home"
        className="ml-1 flex items-center rounded-tile p-0.5 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-overlay/25"
      >
        <BrandLogo />
      </Link>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {aside}
        {chain.status === "ready" ? (
          <Chip tone="ok" dot title={`${NETWORK_LABEL[network]} · ${chain.data.upgrade} active · tip from ${chain.data.endpoint}`}>
            <span className="hidden sm:inline">{NETWORK_LABEL[network]} · </span>
            <span className="font-mono text-xs">{formatInt(chain.data.height)}</span>
          </Chip>
        ) : chain.status === "error" ? (
          <Chip tone="warn" dot title={chain.message}>
            <span className="hidden sm:inline">{NETWORK_LABEL[network]} · </span>tip not available
          </Chip>
        ) : (
          <span className="skeleton h-6 w-24 rounded-chip sm:w-36" role="status" aria-label={`${NETWORK_LABEL[network]} tip loading`} />
        )}
        <Link href="/chains" className="link text-[13px]">
          Chains
        </Link>
        <Link href="/about" className="link text-[13px]">
          About
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
