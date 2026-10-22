# Handoff: Block lookup and Block Trace

Branch `Bimajadivaaa/z-block`. Not pushed, not merged into main. Checked in Chrome on port 3041 on 2026-10-22.

## What works

- **A block hash in the box no longer dead-ends.** A 64-hex input is tried as a txid on Mainnet, then Testnet (as
  before); if neither has it, it is tried as a block hash on Mainnet, then Testnet. If nothing matches, the box says
  "no transaction or block with this hash on Mainnet or Testnet."
- **Decimal heights.** `3526161` or `3,526,161` is read as a block height (`classifyInput` kind `block`), looked up on
  Mainnet first, then Testnet. Heights exist on both networks, so Mainnet wins; the network select in the Block Trace
  header looks the same height (or hash) up on the other network.
- **Block Trace view** (`apps/web/src/components/block-view.tsx`): header (network, height, hash with copy, UTC time,
  previous block hash, which opens that block) and a Trace-style list: `0 → HEADER`, one `1 → TX` row per transaction
  (txid in display order, index, a coinbase chip on index 0) and `2 → TRANSPARENT / SAPLING / ORCHARD / IRONWOOD` rows
  for each pool the transaction touches (vin/vout, spends/outputs, actions). Reuses `KindBadge`, `FieldInline`, the
  trace guides and `ExpandableCard`, so full screen works.
- **Clicking a transaction** runs the normal txid lookup on the block's network; the URL becomes `?tx=…&net=…` and the
  verdict card says "from the block".
- **Shareable link**: `?block=<hash|height>&net=main|test`. Without `net` the link tries Mainnet, then Testnet.

## How

- `POST /api/block` (`apps/web/src/app/api/block/route.ts`) takes `{ block, network }`. `block` must be 64 hex or a
  decimal height from 1 with no padding, signs or separators, at most 2^32 − 1 (`parseBlockRef`); anything else is 400.
- `apps/web/src/server/block.ts`, `lookupBlock`:
  - Height: `GetBlock(BlockID{height})`.
  - Hash: zec.rocks and testnet.zec.rocks answer `GetBlock(BlockID{hash})` with INVALID_ARGUMENT "Block hash specifier is
    not yet implemented" (tried both byte orders on 2026-10-22). So the hash goes to `GetTreeState(BlockID{hash})`,
    which does accept hashes, to learn the height, then `GetBlock` by height. The fetched block's hash must equal the
    requested one, otherwise it is "not found"; this also guards against a server that reads the hash in the other
    byte order.
  - Byte order, verified live: `GetTreeState` wants the hash in **display** (explorer) order and returns it as a display
    hex string; `CompactBlock.hash` and `prevHash` come back in **internal** order and are reversed for display, like
    txids. The internal order sent to `GetTreeState` answers "the requested block is not in the main chain".
  - INVALID_ARGUMENT / OUT_OF_RANGE from the indexer (unknown hash, height past the tip) become `not_found`, because the
    input is already validated.
  - `GetBlock` returns every pool, transparent included (per `service.proto`), and drops the coinbase's null input, so
    coinbase shows `vin=coinbase`. Coinbase is `index == 0`, as the proto recommends.
- Client: `api.block`, `runBlockLookup` / `startBlockLookup` in `inspector-app.tsx`; `runLookup` takes a
  `blockFallback` flag that only the pasted-txid path sets (links with `?tx=` and samples stay txid-only).

## Tests

- `apps/web/src/server/block.test.ts`: validation, request parsing, summary (display order, pool counts, missing
  prevHash/time), hash mismatch and indexer refusal → not found.
- `apps/web/src/server/block.live.test.ts` (`LIVE=1`): Mainnet block 3,526,161 by hash and by height, same prevHash;
  that hash on Testnet and a height past the tip are not found.
- `apps/web/src/lib/input.test.ts`: heights with separators, numeric-looking hex, `isBlockRef`.

## Limits

- Genesis (height 0) is not supported: `BlockID{height: 0}` with no hash is "unspecified" to lightwalletd.
- Counts only. Compact blocks carry no amounts for shielded pools and the view does not decode the block's full
  transactions; open a transaction for that.
- A hash lookup costs up to four indexer round trips (tx main, tx test, tree state, block) per network.
- Opening a transaction replaces the URL; browser Back does not return to the block (the app only reads the URL on load).
- No paging or search in the list; a very large block renders every row.

## Unverified

- Other lightwalletd/Zaino servers set through `INDEXER_MAIN` / `INDEXER_TEST` may implement `GetBlock` by hash or
  read `GetTreeState` hashes in internal order; the hash check after the fetch turns a mismatch into "not found" but
  the view would then miss a block that does exist.
- Blocks with Ironwood actions were not seen live; the `IRONWOOD` row is untested beyond type checking.
- Phone width (390 px) was not checked in the browser for this view.
