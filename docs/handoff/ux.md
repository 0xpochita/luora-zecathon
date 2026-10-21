# Handoff: Task D, simpler UX (Luora) (branch `Bimajadivaaa/z-ux`)

Goal from the user: "simplify the UX so I am not overwhelmed; learn from good UX on Pinterest", plus a later request to make
the Anatomy card full screen. Only `apps/web/src/app/**` (pages), `apps/web/src/components/**` and `apps/web/src/lib/**`
changed. No change to `crates/`, `data/`, `apps/web/src/server/**`, `apps/web/src/app/api/**` or `contract/`.

## Research

17 Pinterest pins studied in the user's Chrome (searches: developer tool empty state dark, search first landing page dark
ui, transaction detail ui crypto, progressive disclosure dashboard, verdict summary card ui, side drawer inspector ui,
fullscreen diagram canvas ui). Notes with pin URLs and which decision each backs: `research/ux-refs.md` (gitignored).
The Luora DESIGN.md tokens stay as they were (dot grid, graphite cards, white for the active element, one mint button).

## What changed, and the reference behind it

| Decision | Change | Refs |
|---|---|---|
| D1 one box, one button | Empty state is one centred card: "Paste a Zcash transaction, txid, PCZT or Zebra error", mint Inspect, Enter submits (Shift+Enter new line). Sample chips with plain names under it (Ironwood transfer, Orchard to Ironwood, Sapling payment, Coinbase reward, Rejected: expired); the long `why` text is the chip tooltip. The other 5 real samples sit behind "5 more examples". One line "Decoded in your browser. Nothing is stored." with an info popover (native `popover`) holding the full privacy text. | R1 R2 R3 R4 |
| Auto-detect | `classifyInput`: 64 hex → txid, longer even hex → raw tx, PCZT magic (hex `50435a54` / base64 `UENaV`) → PCZT, anything with letters, spaces or `:` → Zebra error. The hint under the box says what was detected; for a txid it names both indexer endpoints before Inspect is pressed (privacy rule 3). | R3 |
| D2 network/height off the first screen | Txid lookup tries Mainnet, then Testnet on a 404, and the verdict shows which matched ("found by txid" / "auto-detected"). Network only appears as a select for pasted hex and PCZTs, where the user's choice matters. Height lives in the Rules view as "Check at". | R9 |
| D3 verdict first | Verdict card: one sentence built from decoded pool balances (`describeMovement`), fee from `fee_zat`, and the rule summary from `check_tx` (`summarizeRules`), one semantic dot. Facts: network, mined at, fee, txid + copy + Details. | R6 R10 R11 |
| D4 two views | Overview (anatomy graph + pool-flow strip) and Rules (fail/warn rows first, passes collapsed into "N rules passed, M not applicable ▸"). The tab label says "Rules · 1 failing" when something fails. PCZT and Zebra-error input open their own result layout, so no empty tabs exist. | R8 R10 R15 |
| D5 drawer | The inspector is a native `<dialog>` drawer on the right (bottom sheet under 640 px), opened by clicking a node or "Details"; Esc and a click on the backdrop close it. No permanent empty column. | R2 R12 R13 R14 |
| D6 plain words | Pool labels "Transparent (public)", "Sapling (shielded)", "Ironwood (new pool)"; "value leaves / enters the pool", "no net change", "paid to the miner". Consensus field names (`valueBalanceIronwood`…) move to tooltips; ZIP numbers, branch IDs and bytes stay in the drawer and the Rules rows. | R7 R8 |
| D8 header | Brand (click = back to the empty state), one live chip "Mainnet · 3,525,604", About link. Nothing else. | R5 |
| D9 full screen Anatomy (in page) | Monochrome `ArrowsOut`/`ArrowsIn` icon button ("Full screen" / "Exit full screen") next to "v6 · 6,340 bytes". The card grows **inside the page**: it becomes a `position: fixed` overlay at 16 px inset (0 under 640 px) over a dark scrim (`rgba(0,0,0,.6)` + slight blur), animated from the card's own rect to full size with a FLIP transform (Web Animations API, 280 ms ease-out) and back the same way on close. A placeholder keeps the page from jumping. The browser Fullscreen API is not used at all (user request: Chrome must not go full screen). Close with the button, Esc or a click on the scrim; Esc closes an open drawer first. Body scroll is locked while open. Node clicks still open the drawer above the overlay (modal dialog, top layer). `prefers-reduced-motion` skips the animation. | R16 R17 |

### Motion and loading (second round)

| Decision | Change | Refs |
|---|---|---|
| D10 skeleton, not spinner | While a txid lookup runs (and while the WASM decoder loads) the result area shows skeletons with the exact shape of the verdict card (2 text lines + 4 fact boxes), the view tabs and the Anatomy card (5 node boxes on faint wires, pool-flow boxes). While the spent-output values (prevouts) load, the verdict card and the Rules list stay skeletons, because both depend on those values; the graph is already real. Shimmer is a CSS gradient `#252528 → #2e2e33` (`.skeleton`). Inspect turns into "Inspecting…" (disabled, `aria-busy`). | R18 R19 R20 |
| D11 stagger | Verdict, tabs and the view enter one by one: fade + 8 px rise, 240 ms ease-out, 60 ms apart (`.enter`, `--i`). Pool-flow bars grow from 0 (`.meter-fill`). A new result remounts (`key`), so the entrance replays per result, not per re-render. | R21 R22 |
| D12 graph draws | Nodes appear left to right (Transaction, then the five bundles 40 ms apart, then Fee); wires are drawn with `pathLength=1` + `stroke-dashoffset`, Transaction → pools first, pools → Fee after. | R23 R24 |

All of it is CSS keyframes, no new dependency. Animations use `animation-fill-mode: backwards`, so no transform stays on an
ancestor after the entrance (a lingering transform would trap the in-page full-screen overlay). Under
`prefers-reduced-motion: reduce` every entrance, draw, grow, drawer and pulse animation is off and the skeleton is a flat
`#252528` without shimmer; the expand overlay skips its FLIP animation too.

Verified with `document.getAnimations()` right after a result appeared (1440 iframe, "Coinbase reward" sample): `enter`
at 0 / 60 / 120 ms for the three blocks, node `enter` from 120 to 940 ms, `draw` at 240 ms (Transaction → pools) and 600 ms
(pools → Fee), `grow` on the five bars. Skeletons were captured by delaying `/api/tx` and `/api/prevouts` in the page.

### Adjustment argued by the references (differs from the brief)

The brief said "default Mainnet at the live tip". For a txid that is already mined, checking at the live tip makes every
older transaction fail its expiry rule, so the first verdict a new user sees is "Invalid" for a perfectly valid sample
(R10: order by what the user asked). So: **a mined txid is checked at the height it was mined; pasted hex (height unknown)
is checked at the live tip.** "Check at" offers: height it was mined / current tip / another height. Example with the real
v6 sample `30cdd41f…021c`: "Valid when mined at 3,495,600 (6 of 6 rules pass)"; switching to current tip shows
"Invalid at the current tip (3,525,599): 1 of 6 rules fail (Expiry height)" with the `ExpiredTransaction` hint.

### Other changes

- "Rejected: expired" chip fills the box with `TransactionError::ExpiredTransaction`, the real variant name from Zebra's
  `zebra-consensus/src/error.rs` (the catalog has no real example error strings yet; see the contract proposal in
  `docs/handoff/web.md`). It is a variant name, not an invented error message.
- `matchZebraError`: a variant name now has to appear as a whole identifier. Before, pasting
  `TransactionError::ExpiredTransaction` also ranked `Transaction` and `Expired` variants because their short names are
  substrings. Test added.
- `/about`: mentions the Zebra-error input and the Mainnet → Testnet lookup order, and gained the zcash-devtool PCZT
  recipe that used to live in the empty PCZT tab.
- Removed: the four-tab bar, the permanent Inspector column, the "Why this tool" box (its content is on `/about`), the
  top-bar network/height toolbar, "Runs locally" chip, footer, and the unused `SegmentedControl`, `Toolbar`, `KV`, `PcztEmpty`.
- The view wrapper no longer has the `animate-rise` transform, because a transformed ancestor traps `position: fixed`
  and broke the full-screen overlay.

## Verified in the browser (port 3034, user's Chrome, own tab, closed afterwards)

At 1440 px (iframe) and 390 px (iframe), real data via `zec.rocks:443` and `testnet.zec.rocks:443`:
- One click on "Ironwood transfer" → verdict "Moved 0.0035183 ZEC from transparent (public) into Ironwood (new shielded
  pool). Fee 0.00015 ZEC. Valid when mined at 3,495,600 (6 of 6 rules pass)."
- Pasting testnet txid `7b596d3aba75831e5f23badb93dfb9bc6da5d7b8531a3eed154e0f3ec1e362fa` + Enter → Mainnet 404, found on
  Testnet at 4,525,648: "Shielded transfer inside Ironwood (new shielded pool)… Fee 0.00025 ZEC. Valid when mined (6 of 6)."
- Real PCZT `crates/core/tests/fixtures/pczt/4-combined-unsigned.pczt` (base64) → "5 of 9 signing roles done; a signer
  check warns", Ironwood #3 signature missing.
- "Rejected: expired" → only `TransactionError::ExpiredTransaction`, stage Transaction verifier, ZIP 203.
- Drawer opens on node click, Esc closes it; bottom sheet at 390 px; privacy popover; no console errors;
  `scrollWidth` 390 at 390 px.
- In-page full screen: at 1440 the card fills the page at 16 px inset (1408 × 868 in a 1440 × 900 frame), at 390 it is
  edge to edge; `document.fullscreenElement` stays null; the root gets `overflow: hidden` while open and loses it after;
  a node click opens the drawer above it; Esc closes the drawer, a second Esc runs the shrink animation and puts the card
  back at its old position; a click on the scrim closes it too.

Screens in `docs/screens/ux/`: `before-1440-empty`, `before-1440-result`, `before-390-empty`; `after-1440-empty`,
`after-1440-result`, `after-1440-drawer`, `after-1440-rules-at-tip`, `after-1440-expanded`, `after-1440-expanded-drawer`,
`after-1440-testnet-autodetect`, `after-1440-pczt`, `after-1440-zebra-error`, `after-1440-privacy-popover`,
`after-390-empty`, `after-390-result`, `after-390-expanded`, `after-1440-skeleton`, `after-1440-skeleton-prevouts`,
`after-390-skeleton`.

## Commands

```bash
pnpm install
pnpm --filter web exec next dev -p 3034     # needs network for Google Fonts and the indexers
cd apps/web
pnpm lint                                   # clean
pnpm exec tsc --noEmit -p .                 # clean
pnpm test                                   # 47 passed, 12 skipped (live tests)
pnpm build                                  # passes
```

New tests: `src/lib/input.test.ts` (routing of the one box) and `src/lib/summary.test.ts` (verdict sentences and rule
counts from the real WASM decoder on the real v6 Ironwood tx at height 3,495,600 and the v4 coinbase at height 1,000,000).

## Not done / open

- No clickable PCZT sample: the real PCZT fixtures live in `crates/core/tests/fixtures/pczt/`, outside the folders this task
  may change. Copying one into `apps/web/public/` (or serving it from `/api/samples`) would allow a "PCZT" chip.
- No real Zebra error *message* sample (only the variant name); needs `ZebraErrorEntry.examples` from agent C.
- If turbopack ever serves stale CSS after editing `globals.css`, stop the dev server and delete `apps/web/.next`.
