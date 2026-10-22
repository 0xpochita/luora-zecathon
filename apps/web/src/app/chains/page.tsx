import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { ChainWatch } from "@/components/chain-watch";
import { ExternalLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Chains · Luora",
  description: "Do the public Zcash lightwalletd and Zaino backends agree on the chain?",
};

export default function ChainsPage() {
  return (
    <div className="min-h-dvh font-sans text-[13px] text-fg dot-grid">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <Link
          href="/"
          className="inline-flex h-8 items-center gap-2 rounded-tile bg-raised px-3 text-[13px] text-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-white/25"
        >
          <ArrowLeft />
          Back to the inspector
        </Link>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-12">
        <div className="flex flex-col gap-1.5 px-1 pt-4">
          <h1 className="text-ui-display font-medium">Do the backends agree?</h1>
          <p className="text-[14px] leading-relaxed text-muted">
            Zcash now runs on more than one node implementation, and a consensus split first shows as two nodes following
            different chains. This page asks a fixed list of public lightwalletd and Zaino endpoints for their tip, compares
            block hashes over the last 1,000 shared blocks and names the first height where they differ. It reads public
            block headers only. See <ExternalLink href="https://github.com/ZcashFoundation/zebra/issues/11675">Zebra #11675</ExternalLink>.
          </p>
        </div>
        <ChainWatch />
      </main>
    </div>
  );
}
