# Zecathon submission: Luora

## Description (for the form, under 2,000 characters)

<!-- form-text-start -->
Luora reads one Zcash transaction the way a debugger reads memory. Paste a txid, raw hex, a PCZT or a Zebra error and see the structure byte by byte, the consensus rules it passes or breaks at any height, and why a node said no.

Who uses it on Monday: wallet and SDK developers testing v6 Ironwood transactions, exchange engineers chasing a stuck or rejected withdrawal, Zebra operators reading logs, and anyone about to sign a PCZT.

Stack: librustzcash (zcash_primitives, zcash_protocol, zcash_address, pczt, orchard, sapling-crypto) compiled to WebAssembly decodes v4, v5 and v6 and runs ten rules, each citing its ZIP and the Zebra or librustzcash line it mirrors. 285 Zebra error variants were extracted from Zebra v7.0.0-rc.0 source and are matched against what you paste. Txid lookups use lightwalletd (zec.rocks). Halo 2 and Groth16 proofs verify in the native CLI. PCZTs were made with zcash-devtool on testnet.

Privacy: hex and PCZTs are decoded in the tab and never sent. A txid lookup is one POST to our route, which logs nothing. No keys, cookies or analytics. A share link can carry hex only after the # (never sent to a server), only if you tick a box.

Real: every sample, fixture, PCZT and regtest rejection is real, with txid and height. Not mocked, not done: proof verification in the browser; shielded amounts stay unknown by design.

Open issues it answers:
- zcash-devtool #247: inspect Ironwood bundles of v6
- zcash-devtool #243: fee and expiry of a PCZT
- Thus Spoke Zakura #265: decode raw transactions
- librustzcash #3155: Signer never checks user_address
- librustzcash #2768: unsafe PCZT signer defaults; we caught devtool skipping an Ironwood signature
- librustzcash #3115, #3137: v6 read/write and txid mismatches; every fixture round-trips its ZIP 244 txid
- Zebra #11238: when input values are missing, Luora says so instead of a wrong fee

New: mempool "why stuck" and Copy as GitHub issue.
<!-- form-text-end -->

Links for the form: [zcash-devtool #247](https://github.com/zcash/zcash-devtool/pull/247) · [zcash-devtool #243](https://github.com/zcash/zcash-devtool/pull/243) · [Thus Spoke Zakura #265](https://github.com/zcashlabs/thus-spoke-zakura/issues/265) · [librustzcash #3155](https://github.com/zcash/librustzcash/issues/3155) · [librustzcash #2768](https://github.com/zcash/librustzcash/issues/2768) · [librustzcash #3115](https://github.com/zcash/librustzcash/issues/3115) · [librustzcash #3137](https://github.com/zcash/librustzcash/issues/3137) · [Zebra #11238](https://github.com/ZcashFoundation/zebra/issues/11238)

Every issue above was opened on GitHub on 2026-10-22 to check its number, title and state. #2768 is closed; the others are open.

## Numbers used, and where they come from

| Claim | Source in the repo |
|---|---|
| ten rules | `crates/core/src/checks.rs`, README "Rules At Any Height" |
| 285 Zebra variants, v7.0.0-rc.0 | `data/zebra-errors.json`, `docs/handoff/data.md` |
| v4, v5, v6 decode, ZIP 244 txid round-trip | `crates/core/tests`, `docs/handoff/core.md` |
| PCZTs from zcash-devtool on testnet, skipped Ironwood signature | `crates/core/tests/fixtures/pczt/`, `docs/handoff/core.md` |
| proofs verified natively | `crates/core/src/verify.rs` |
| mempool status and issue export | `docs/handoff/issue.md` |

## Two-minute video outline

| Time | Shot | Line |
|---|---|---|
| 0:00 to 0:12 | Explorer showing an Ironwood transfer as "0.0 ZEC", then Luora's empty box | "Since Ironwood, tools misread v6 transactions. Luora reads one transaction, from its bytes to the rule it breaks." |
| 0:12 to 0:35 | Click the "Ironwood transfer" sample. Verdict, then the Trace rows with byte offsets | "librustzcash, compiled to WebAssembly, decodes it in the tab. Every element has its offset. The fee comes from the real input values." |
| 0:35 to 0:55 | Rules tab, change the height to 3,428,142 | "Ten consensus rules, each with its ZIP and the Zebra line it mirrors. One block before NU6.3, branch ID and version fail." |
| 0:55 to 1:12 | Paste a txid that is in the mempool right now | "Not mined yet? Luora checks it at the next block: blocks left before expiry, fee against ZIP 317 and ZIP 2009, and any rule that keeps it out." |
| 1:12 to 1:28 | Paste a Zebra error from the regtest samples | "Zebra folds every failure into one RPC code. Luora finds the exact variant among 285 extracted from Zebra's source, with the stage and the fix." |
| 1:28 to 1:45 | Paste the unsigned PCZT; the Ironwood action 3 signature warns | "zcash-devtool skipped this Ironwood signature and the Combiner accepted it. Luora flags it before extraction." |
| 1:45 to 1:55 | Click Copy as issue, show the preview and the opt-in hex checkbox | "One click turns the finding into a GitHub issue. Raw hex only goes in the link if you tick the box, and only after the #." |
| 1:55 to 2:00 | "Decoded in your browser. Nothing is stored." line, repo link | "No keys, no tracking. Built on librustzcash, Zebra and lightwalletd." |

Before recording: pick a fresh mempool txid with `GetMempoolStream` (see `docs/handoff/issue.md`), because mempool transactions are mined within minutes.
