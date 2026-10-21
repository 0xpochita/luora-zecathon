import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/ssr";
import { ExternalLink, LogoMark, Panel } from "@/components/ui";

export const metadata: Metadata = {
  title: "About · luora z",
  description: "What luora z is, the problems it addresses, its privacy model and what it checks.",
};

const PROBLEMS = [
  {
    title: "Ironwood transactions are invisible to common tools",
    body: "NU6.3 Ironwood (mainnet height 3,428,143, branch ID 0x37A5165B) added the v6 transaction (ZIP 229) and a fourth shielded pool. Explorers show Ironwood transfers as 0.0 ZEC, zcash-devtool inspect cannot read v6 yet, and regtest users ask for a raw-tx decoder.",
    links: [
      { label: "lifinance/data-types #281", href: "https://github.com/lifinance/data-types/pull/281" },
      { label: "zcash-devtool #204", href: "https://github.com/zcash/zcash-devtool/issues/204" },
      { label: "zcash-devtool #247", href: "https://github.com/zcash/zcash-devtool/pull/247" },
      { label: "ZIP 229", href: "https://zips.z.cash/zip-0229" },
    ],
  },
  {
    title: "Rejections are opaque",
    body: "Zebra's sendrawtransaction maps every verifier failure to one RPC error code. Around 60 TransactionError and 30 ValidateContextError variants never reach the user as a reason. luora z maps the message back to the variant, the validation stage and the rule.",
    links: [{ label: "zebra-consensus/src/error.rs", href: "https://github.com/ZcashFoundation/zebra/blob/main/zebra-consensus/src/error.rs" }],
  },
  {
    title: "PCZT signers can be shown the wrong payee",
    body: "The reference PCZT Signer does not check user_address against the committed recipient, and a hardware wallet once returned unsigned PCZTs that the Combiner merged silently. luora z shows which ZIP 374 roles ran and flags shown-versus-committed mismatches.",
    links: [
      { label: "librustzcash #3155", href: "https://github.com/zcash/librustzcash/issues/3155" },
      { label: "librustzcash #2768", href: "https://github.com/zcash/librustzcash/issues/2768" },
      { label: "ZIP 374", href: "https://zips.z.cash/zip-0374" },
    ],
  },
];

const CREDITS = [
  { name: "librustzcash", detail: "zcash_primitives, zcash_protocol, zcash_address, orchard, sapling-crypto, pczt", licence: "MIT or Apache-2.0", href: "https://github.com/zcash/librustzcash" },
  { name: "Zebra", detail: "error catalog extracted from zebra-consensus, zebra-state and zebra-chain", licence: "MIT or Apache-2.0", href: "https://github.com/ZcashFoundation/zebra" },
  { name: "lightwalletd", detail: "CompactTxStreamer gRPC used for txid lookups", licence: "MIT", href: "https://github.com/zcash/lightwalletd" },
  { name: "Zaino", detail: "CompactTxStreamer-compatible indexer", licence: "Apache-2.0", href: "https://github.com/zingolabs/zaino" },
  { name: "Phosphor Icons", detail: "interface icons", licence: "MIT", href: "https://phosphoricons.com" },
];

export default function AboutPage() {
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
        <div className="flex items-center gap-3 px-1 pt-4 pb-2">
          <LogoMark size={34} />
          <h1 className="text-ui-display font-medium">luora z</h1>
        </div>
        <p className="px-1 text-[15px] leading-relaxed text-body">
          A local-first inspector for Zcash transactions, built for the Zecathon Core &amp; Tooling track. Paste a raw
          transaction, a txid or a PCZT and see its anatomy, the consensus and fee rules it meets at any height, why Zebra
          rejected it, and how far a PCZT got through signing.
        </p>

        <Panel label="Three problems it addresses" bodyClassName="gap-2 px-4 pb-4">
          {PROBLEMS.map((problem) => (
            <div key={problem.title} className="flex flex-col gap-1.5 rounded-inner border border-border bg-inner-grad p-3">
              <h2 className="text-[14px] font-medium text-fg">{problem.title}</h2>
              <p className="leading-relaxed text-body">{problem.body}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                {problem.links.map((link) => (
                  <ExternalLink key={link.href} href={link.href}>
                    {link.label}
                  </ExternalLink>
                ))}
              </div>
            </div>
          ))}
        </Panel>

        <Panel label="Privacy model" dot="ok" bodyClassName="gap-2 px-4 pb-4 leading-relaxed text-body">
          <p>
            Raw hex and PCZTs are parsed by librustzcash compiled to WebAssembly, inside this browser tab. They are never
            uploaded, never put in the URL and never stored.
          </p>
          <p>
            Looking up a transaction by txid is the one exception: our server route asks a public lightwalletd or Zaino
            endpoint for that transaction and returns its hex, which is then decoded in the tab. The endpoint is named next
            to the input before you press Inspect. A shared link carries only the txid and network.
          </p>
          <p>
            No analytics, no cookies, no third-party scripts, no server logs of txids or hex, no viewing keys, and never any
            linking, clustering or deanonymisation feature. Fonts are self-hosted.
          </p>
        </Panel>

        <Panel label="What is checked, and what is not" bodyClassName="gap-2 px-4 pb-4 leading-relaxed text-body">
          <p>
            Checked from public fields: transaction version and version group, consensus branch ID against the network
            upgrade active at the chosen height, expiry height, flag bits of Orchard and Ironwood bundles, the Orchard
            turnstile after NU6.3, Halo 2 proof sizes against ZIP 257, and the ZIP 317 conventional fee. Each check links
            the ZIP clause and the librustzcash or Zebra source it mirrors.
          </p>
          <p>
            Not checked: proofs and signatures are checked for presence and size, not cryptographically verified. Anything
            that needs the chain state, such as whether a nullifier was already spent or an anchor is known, is out of
            scope. Shielded amounts, senders, recipients and memos stay encrypted and are never shown.
          </p>
        </Panel>

        <Panel label="Built on" bodyClassName="gap-1.5 px-4 pb-4">
          {CREDITS.map((credit) => (
            <div key={credit.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
              <ExternalLink href={credit.href} className="text-[13px]">
                {credit.name}
              </ExternalLink>
              <span className="text-body">{credit.detail}</span>
              <span className="ml-auto text-[12.5px] text-dim">{credit.licence}</span>
            </div>
          ))}
        </Panel>
      </main>
    </div>
  );
}
