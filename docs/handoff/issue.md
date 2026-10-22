# Handoff: Task H (Copy as issue, mempool "why stuck", honest fee)

Branch `Bimajadivaaa/z-issue`. Not pushed, not merged. Checked in Chrome on port 3037 on 2026-10-22.

## What works

### 1. Copy as GitHub issue

- A **Copy as issue** button (Phosphor `GithubLogo`) on the verdict card, in the Why rejected panel header and in the PCZT
  panel header. It opens a drawer with a Markdown preview, **Copy Markdown** and **Copy link**.
- The Markdown (`apps/web/src/lib/issue.ts`, `buildIssueMarkdown`) holds: a `##` title line, network, the height the rules
  ran at, the txid (pasted hex is never included: "unbroadcast hex, not included", with the txid computed in the browser),
  the state (mined at N, in the mempool, pasted), the verdict sentence, the mempool lines, every failing or warning rule
  with its ZIP link, clause and source line, the matched Zebra variant (stage, message, source link at the catalog
  commit, ZIPs, other candidates) and the pasted error in a code fence, the PCZT role summary and per-pool action,
  proof and signature counts, the decoder versions (librustzcash `8672a4b2…`, Zebra catalog tag) and an "Open in Luora"
  link.
- **Share link** (`apps/web/src/lib/share-link.ts`). A looked-up txid keeps the existing `?tx=<txid>&net=` link. For
  pasted hex or a PCZT the link is the bare page unless the user ticks **Include the raw transaction / PCZT in the
  link**; then it goes into the URL fragment, `#hex=<hex>&net=main` or `#pczt=<base64 or hex, URI-encoded>&net=test`.
  Browsers never send the fragment to a server. The drawer warns what it reveals (transparent addresses and amounts for
  hex; every action's value and recipient for a PCZT) and that posting the issue publishes it. Limit: 50,000 characters
  of fragment (GitHub caps an issue body at 65,536); above that the drawer says "Too big for a link: N characters" and
  the link leaves it out. Hex never goes into the query string.
- On load, `#hex=` / `#pczt=` is read once (`readShareFragment`, validated with the same `classifyInput` as the input box)
  and opens straight into the result, decoded in the tab. `?tx=` keeps priority if both are present.

### 2. Mempool "why stuck"

- `/api/tx` now also returns `mempool: true` when lightwalletd answers with height 0 (`apps/web/src/server/indexer.ts`,
  `getTransaction`); a non-main-chain answer (`2^64 − 1`) stays `height: null, mempool: false`.
- For a mempool transaction the verdict starts with **"In the mempool, not mined yet."**, the rules run at **tip + 1**
  ("in the next block (N)"), "Mined at" says "in the mempool", and a panel shows (`apps/web/src/lib/mempool.ts`):
  - expiry: "Expires in N blocks: it must be mined by block E (tip T)", with N = E − T, from ZIP 203 ("If the expiry is at
    block height N, then the transaction must be included in block N or earlier"); expired when N < 1; "Never expires"
    for `nExpiryHeight` 0;
  - fee against the ZIP 317 conventional fee (`zip317.conventionalFeeZat` from `zcash_primitives`) and the ZIP 2009 fee
    (1,000 zat × max(2, logical actions), same formula as `crates/core/src/decode.rs:229`), or "input values unavailable";
  - the failing and warning rules at tip + 1, and one sentence on what keeps it out of a block.
- The tip comes from `/api/chain` (cached 30 s), so "blocks left" can be one block stale.

### 3. Honest fee

When any transparent input value is unknown, no fee number is shown anywhere. Every place that formats a fee now goes
through `feeLabel` / `FEE_UNAVAILABLE_WHY` in `apps/web/src/lib/fee.ts`:

| Place | Shows | Tooltip / detail |
|---|---|---|
| Verdict sentence | "Fee: input values unavailable." (dotted underline) | `title` with the reason |
| Fee fact tile | "input values unavailable" | `title` |
| Trace FEE row | "input values unavailable" | `title` on the label, the reason in the row details drawer |
| Graph Fee node | "input values unavailable" (smaller font so it fits the node) | SVG `<title>` |
| Pool-flow tiles | "unavailable" for Transparent and Fee | `title` |
| Fee details (node inspector) | the label and the reason | inline |
| Rules, ZIP 317 fee | title gets "(input values unavailable)", detail gets the reason | `withHonestFee`, applied to the `check_tx` output in the web app only |
| Ask AI fee field | "input values unavailable" | |

The reason: the fee needs the spent outputs' values, which are not inside the transaction, and Zebra's built-in
lightwalletd server omits transparent vin/vout ([Zebra #11238](https://github.com/ZcashFoundation/zebra/issues/11238)).
While values are being fetched the label says "fetching input values…". A coinbase shows "none (coinbase)".

## Commands

```bash
pnpm install
pnpm --filter web exec next dev -p 3037
pnpm --filter web lint
pnpm --filter web test          # 83 offline tests, 12 live skipped
pnpm --filter web build
```

New tests: `apps/web/src/lib/issue.test.ts` (9: Markdown for a tx, a zebrad rejection and a PCZT; share-link query,
fragment round-trip for hex and base64 PCZT, size limit, rejects junk fragments) and
`apps/web/src/lib/mempool.test.ts` (6: blocks left, fee comparison, expiry boundary, no expiry, unavailable fee and the
rewritten ZIP 317 rule, ZIP 2009 formula).

## Real data used

- **Mempool fixture** `apps/web/src/lib/fixtures/mempool-observed.json`: two transactions seen with
  `GetMempoolStream` on `zec.rocks:443` at 2026-10-22T12:24:25Z, with `GetLatestBlock` = 3,526,665 before and after the
  stream, then fetched through `POST /api/tx` (height `null`) and `POST /api/prevouts`:
  - `da9faafcd45c4876ab7cc17530892b31e446544efea834c0e7bda0570f17e3e5`: v6 Ironwood, `nExpiryHeight` 3,526,706, fee
    10,000 zat = ZIP 317 conventional, 41 blocks left at tip 3,526,665. The expired case in the test is the same real
    transaction evaluated at tip 3,526,706.
  - `0b92afbc88df7b92f09095406c368b142e3e9cf1bf35c1a3997126394181e193`: v4, four transparent inputs (prevout values
    102,705,811,284 / 41,119,737,056 / 29,406,909,968 / 280,000 zat), `nExpiryHeight` 0, fee 280,000 zat.
- **Live checks in the browser** (mainnet, `zec.rocks:443`): `69e26d305aa49cf091bd85fa8f4bfb55e631b885511f20a14eb28f96c423b096`
  (v6 Ironwood, in the mempool at tip 3,526,673, expiry 3,526,677: "Expires in 4 blocks") and
  `0f1b44ad9bffc3044b5328a2e8f57e2bc73fd0e61db136dab5805d6cb5682c7e` (v4, in the mempool at tip 3,526,676, never
  expires, fee 0.00015 ZEC). Mainnet transactions leave the mempool within a few blocks, so these txids are mined by now.
  To find a fresh one: `grpcurl -import-path apps/web/src/server/proto -proto service.proto -max-time 6 zec.rocks:443
  cash.z.wallet.sdk.rpc.CompactTxStreamer/GetMempoolStream`, decode the `data` field and compute the txid (any v5/v6
  decode in Luora shows it).
- Not observed live: a mempool transaction that is **stuck** (expired, low fee or failing a rule). Every one seen was
  healthy and got mined. The expired and unavailable-fee paths are covered by the unit tests above on real transactions.
- Issue tests use the real v6 transfer `30cdd41f…fc021c` (mainnet 3,495,600) checked at 3,497,100 (one past its expiry
  3,497,099), the regtest zebrad `expired` sample from `data/zebra-error-samples.json`, and the testnet PCZT
  `crates/core/tests/fixtures/pczt/4-combined-unsigned.pczt`.

## Screens (`docs/screens/issue/`)

- `mempool-1440.jpg`: verdict for a live mempool tx, expiring in 4 blocks
- `copy-issue-mempool-1440.jpg`: the issue drawer for that tx
- `copy-issue-hex-link-1440.jpg`: pasted hex opened from a `#hex=` link, the opt-in box ticked
- `rules-fee-unavailable-1440.jpg`: ZIP 317 rule with "input values unavailable"
- `graph-fee-unavailable-1440.jpg`: Graph Fee node and pool tiles
- `copy-issue-pczt-1440.jpg`: PCZT issue drawer, raw PCZT box ticked
- `copy-issue-why-rejected-1440.jpg`: Why rejected issue drawer
- `mempool-390.png`, `copy-issue-390.png`: 390 px (iframe, `scrollWidth` 389, no horizontal scroll)

## Shared files touched (kept small for the merge with Task G)

- `inspector-app.tsx`: imports, `mempool` on `LoadedTx`, `nextBlock` for the tip + 1 height, `withHonestFee` on the
  `check_tx` result, the `mempool` memo, the fragment-reading effect, three `<CopyIssue>` mounts.
- `anatomy-view.tsx`, `trace-view.tsx`, `node-inspector.tsx`, `lib/anatomy.ts`, `lib/trace.ts`, `lib/ai/subject.ts`:
  fee label and tooltip only.
- `checks-view.tsx` and `crates/core` are untouched. The ZIP 317 rule is relabelled in the web app (`withHonestFee`),
  so if Task G changes the `zip317-fee` detail text, the relabel still applies (it keys on id + status `na`).

## Not done / notes

- `LIBRUSTZCASH_REV` is a constant in `lib/issue.ts`; if Task G bumps the librustzcash pin, update it there too.
- The issue Markdown takes the first Zebra match as the variant, the same order the Why rejected view shows. For a
  mempool-wrapped message the top match can be the wrapper (`TransactionDownloadVerifyError::Invalid`) with the inner
  variant listed under "Other candidates".
- The mempool tip is not re-polled while the page is open.
- Contract: `/api/tx` gained an optional `mempool: boolean`. Proposal: add it to the route comment in `contract/types.ts`.
