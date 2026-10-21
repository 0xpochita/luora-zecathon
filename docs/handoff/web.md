# Handoff: agent B (apps/web UI)

Branch `Bimajadivaaa/z-web`. Contains the UI plus merges of `Bimajadivaaa/z-data` (agent C, up to `36efef8`) and
`Bimajadivaaa/z-core` (agent A, up to `ff4f33e`).

## What works

Verified in the browser on port 3031 with the real v6 transaction
`30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c` (mainnet, mined at height 3,495,600, looked up
through `zec.rocks:443`):

- **Input**: one field for raw hex (decoded in the tab), a txid (64 hex, `POST /api/tx`), or a PCZT (hex starting
  with `50435a54` or base64 starting with `UENaV`, the `PCZT` magic). Cmd/Ctrl+Enter inspects. Privacy note names the
  endpoint returned by `/api/chain`. URL state `?tx=<txid>&net=main|test` only; hex and PCZTs never reach the URL.
- **Top bar**: Mainnet/Testnet segmented control, height field (empty = live tip from `/api/chain`, placeholder shows it),
  chip with the upgrade active at the chosen height from `upgrade_at`, "Runs locally" chip, about link.
- **Anatomy**: SVG node graph Transaction → Header / Transparent / Sapling / Orchard / Ironwood → Fee with bezier wires,
  white wires on the selected path, red title dot and red wire on nodes with a failing check, empty bundles dimmed.
  Separate narrow layout under 768 px. Pool-flow strip with net balance per pool (consensus sign) and fee.
  Fee = `fee_zat` with input values from `/api/prevouts` (auto for txid lookups; a button for pasted hex, since that
  asks the indexer about the spent outputs). For the v6 sample: transparent +0.0036683, Ironwood −0.0035183,
  fee 0.00015 ZEC (15,000 zat, equal to the ZIP 317 conventional fee for 3 logical actions).
- **Inspector**: every public field of the selected node, hashes in Geist Mono with copy buttons, nullifier/commitment
  lists, spec links (ZIP 225/229/244/203/257/317, protocol spec for v4).
- **Checks**: summary chips and rows from `check_tx`, sorted fail → warn → pass → n/a, each with ZIP link and source.
  Re-runs instantly on network/height change. Sample at the live tip: expiry fails (expiry 3,497,099). At 3,495,600: all
  pass. At 3,428,142 (one block before NU6.3): branch ID and v6 version fail, chip shows NU6.2.
- **Why rejected**: client-side ranking over the 285-entry catalog from `/api/zebra-errors` (variant name → message
  template with placeholders, also when the tail is cut off → shared words). Top match shows the pipeline stage strip,
  plain explanation, ZIP links and a GitHub link to the Zebra source at the extracted commit. When a tx is loaded,
  its failing checks are shown underneath.
- **PCZT**: role chips, per-action table, signer check rows; empty state explains zcash-devtool; parse errors from
  `inspect_pczt` are shown verbatim.
- **/about**: the three problems with issue links, privacy model, what is and is not checked, credits with licences
  (librustzcash MIT/Apache-2.0, Zebra MIT/Apache-2.0, lightwalletd MIT, Zaino Apache-2.0, Phosphor MIT; checked on GitHub).
- Empty, loading and error states for WASM init (incl. "decoder not built yet" when `public/wasm` is missing), chain,
  tx lookup, prevouts, samples and the error catalog.
- Privacy: strict CSP (`default-src 'self'`, `connect-src 'self'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`),
  `Referrer-Policy: no-referrer`, fonts self-hosted by `next/font`, no analytics, no cookies, no third-party requests.

## Commands

```bash
pnpm install                       # repo root, one lockfile for the workspace
cd apps/web
pnpm dev                           # http://localhost:3031
pnpm lint                          # clean
pnpm exec tsc --noEmit -p .        # clean
pnpm test                          # vitest: C's server tests + src/lib/zebra-match.test.ts (14 tests)
pnpm build                         # passes
```

The WASM module is loaded at runtime by `public/core-loader.mjs` (`import("/wasm/luora_z_core.js")` then `init()`), so
the bundler never touches agent A's output.

## Screens (`docs/screens/`, about 1485 px wide unless noted)

- `anatomy-v6-ironwood.jpg`: v6 sample, Ironwood node selected, inspector with the bundle fields
- `checks-at-tip.jpg`: live tip, expiry fails
- `checks-at-3428142.jpg`: height before NU6.3, branch ID and version fail
- `why-rejected-expired.jpg`: ExpiredTransaction matched by template, with the loaded tx's failing check
- `pczt-empty.jpg`: PCZT empty state
- `about.jpg`
- `mobile-390.jpg`: three 390 px iframes (input, checks, why rejected); `scrollWidth` 390, no horizontal scroll

## Not done / open

- **Agent A's committed WASM is stale**: `apps/web/public/wasm` on `z-core` was built at the decode spike, so its
  `check_tx` returns `[]`. All screenshots and checks above used a local rebuild of `crates/core` at `ff4f33e`
  (`wasm-pack build --target web --release`), which was **not committed** here. A must commit a fresh build.
- **No real PCZT yet**: the full PCZT panel (roles, action table, signer checks) has only been exercised through the
  error path. Needs a real testnet/regtest PCZT from zcash-devtool (agent A fixtures).
- **Samples**: `data/samples.json` is still `[]` on `z-data`, so the samples list shows "No samples published yet."
- **Zebra error samples**: the Why rejected view has no clickable example errors yet; it will show C's regtest error
  strings once they exist in the data (no field for them in the contract yet, see below).
- Tabs do not animate the white tile between tabs (Luora uses `motion`); skipped to avoid a dependency.
- `cacheComponents` was turned off: C's routes export `dynamic`/`runtime`, which Next 16 rejects with it on.
- Anatomy maps a failing check to a node by keywords in the check `id` (`branch`, `expiry` → Header, `orchard` →
  Orchard, …). A `node` field on `Check` would remove the guesswork.

## Contract proposals

1. `Check.node?: "header" | "transparent" | "sapling" | "orchard" | "ironwood" | "fee"` so the graph marks the right
   node without keyword matching.
2. `ZebraErrorEntry.examples?: { text: string; source: string }[]` (real error strings, e.g. from regtest
   `sendrawtransaction`) so Why rejected can offer one-click samples.
3. `ZebraErrorEntry.zebraVersion` is currently `"v7.0.0-rc.0 (6d1e414d6f)"`; the UI extracts the commit in parentheses
   for GitHub links. A separate `zebraCommit` field would be cleaner.
