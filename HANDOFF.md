# Handoff: agent C (chain data, Zebra error catalog, real samples)

Branch `Bimajadivaaa/z-data`. Everything below was run on 2026-10-21 against live endpoints and a real zebrad.

## What works

| Piece | Where | Status |
|---|---|---|
| Indexer gRPC client (lightwalletd / Zaino `CompactTxStreamer`) | `apps/web/src/server/indexer.ts` | `GetLightdInfo`, `GetLatestBlock`, `GetBlock`, `GetBlockRange` (all four pool types), `GetTransaction`. 8 s deadline, one retry on `UNAVAILABLE`/`DEADLINE_EXCEEDED`, errors mapped to `{ code, message }`. Nothing is logged. |
| Vendored protocol | `apps/web/src/server/proto/` | `service.proto` + `compact_formats.proto` copied verbatim (with their MIT header) from `zcash/lightwallet-protocol` `2a80ce8470a07d22ef9dbd77bb69523186424e1a` (2026-10-19). See `SOURCE.txt`, `LICENSE`. |
| `GET /api/chain?network=main\|test` | `apps/web/src/app/api/chain/route.ts` | `{ network, height, branchId, upgrade, endpoint, fetchedAt }`, `Cache-Control: public, max-age=30, s-maxage=30`. |
| `GET /api/tx/<txid>?network=` | `apps/web/src/app/api/tx/[txid]/route.ts` | `{ txid, hex, height \| null, endpoint }`, `no-store`. Height is `null` for mempool (`0`) and non-main-chain (`2^64-1`) answers. |
| `GET /api/prevouts/<txid>?network=` | `apps/web/src/app/api/prevouts/[txid]/route.ts` | `{ values: (number\|null)[] }`, one entry per transparent input, `null` for coinbase inputs and for parents that cannot be fetched. `no-store`. |
| `GET /api/samples` | `data/samples.json` | 9 real transactions (below). |
| `GET /api/zebra-errors` | `data/zebra-errors.json` | 285 variants. |
| Transparent bundle reader | `apps/web/src/server/transparent.ts` | Reads v1 to v6 headers and transparent inputs/outputs (value + scriptPubKey). This is what the prevout route uses; it does **not** call agent A's CLI. |
| Error matcher | `apps/web/src/server/match-error.ts` | `matchError(text, catalog, limit)` returns ranked `{ entry, score, how, wrapsAnotherMatch }`. Pure TypeScript, no Node APIs, so the UI can import it and match **in the browser** with the `/api/zebra-errors` data (pasted error text then never leaves the tab). |
| Network upgrades | `data/upgrades.json` | Mainnet and testnet heights + branch IDs, cross-checked (see below). `apps/web/src/server/upgrades.ts` exposes `upgradeAtHeight`. |

Validation: txid must match `^[0-9a-fA-F]{64}$`; `network` must be `main` or `test` (default `main`); `regtest` only with `ALLOW_REGTEST=1` and `INDEXER_REGTEST` set. Endpoints come only from env (`INDEXER_MAIN`, `INDEXER_TEST`, `INDEXER_REGTEST`; prefix `http://` for plaintext, e.g. `http://localhost:8137` for a local Zaino), never from the request. All routes are `force-dynamic`, Node.js runtime.

Privacy: `next.config.ts` sets `logging.incomingRequests: false`, because `next dev` otherwise prints every request path (which contains the txid). `next start` prints no request lines (checked). Indexer error messages never echo the txid. **Open risk for deploy:** Vercel's own request logs record request paths, so `/api/tx/<txid>` paths reach Vercel's logs. The contract puts the txid in the path; if that matters for judging, move it to a POST body (contract change, see end).

## Commands

```bash
cd apps/web && pnpm install
pnpm dev -p 3032                        # routes at http://localhost:3032/api/...
pnpm test                               # 35 offline unit tests (vitest)
pnpm test:live                          # + 12 live tests against zec.rocks / testnet.zec.rocks
pnpm build

cd scripts && pnpm install              # @noble/* for the regtest signer, tsx
pnpm upgrades                           # data/upgrades.json      (needs git, network)
pnpm zebra-errors                       # data/zebra-errors.json  (needs git, cargo)
pnpm samples                            # data/samples.json       (needs network)
pnpm regtest-errors                     # data/zebra-error-samples.json (needs Docker)
pnpm fixtures                           # apps/web/src/server/fixtures/mainnet-transactions.json
```

Scripts clone sources into `/tmp/luora-z-src/` (`zebra-<tag>`, `librustzcash`). `ZEBRA_TAG=v6.4.2 pnpm zebra-errors` pins another tag; default is the newest `v*` tag.

Tests: `txid.test.ts` (validation, byte order), `transparent.test.ts` and `prevouts.test.ts` (real mainnet v6 tx `30cdd41f…` and its two parents, fixtures fetched from zec.rocks), `networks.test.ts`, `match-error.test.ts` (every recorded zebrad rejection must rank its real variant first), `indexer.live.test.ts` (skipped unless `LIVE=1`).

## Endpoints (verified 2026-10-21)

| Network | Endpoint | Server | Backend node | Branch at tip |
|---|---|---|---|---|
| main | `zec.rocks:443` (TLS) | ECC LightWalletD v0.5.3, protocol v0.5.0 | `/Zebra:6.3.0/` | `0x37a5165b` NU6.3, height 3,525,5xx |
| test | `testnet.zec.rocks:443` (TLS) | ECC LightWalletD v0.5.4, protocol v0.5.0 | `/Zebra:7.0.0-rc.0/` | `0x77190ad9` NU7, height 4,525,6xx |

`GetTransaction` wants the txid in internal (reversed) byte order; an unknown txid returns gRPC `NOT_FOUND` (mapped to HTTP 404 `not_found`).

## Zebra catalog

- Source: `ZcashFoundation/zebra` tag **v7.0.0-rc.0**, commit `6d1e414d6f55e4180d0e47baaa934bf97d5b4fec` (newest release tag; mainnet zec.rocks runs 6.3.0, testnet runs 7.0.0-rc.0).
- Parser: `scripts/zebra-error-extractor` (Rust, `syn` 2) walks every `thiserror` enum/struct in `zebra-chain`, `zebra-consensus`, `zebra-state`, `zebra-script`, `zebra-rpc`, `zebra-node-services`, `zebrad/src/components` (non-test files), reads `#[error(...)]`, `#[error(transparent)]`, enum-level messages and hand-written `impl Display` match arms (`zebra_script::Error`, `ValueBalanceError`). The driver fails if any file has more `#[error(` attributes than parsed entries, any variant lacks a message or stage, or a note names an unknown variant.
- 332 variants found; 285 kept. 47 excluded as not validation results (startup/config, key generation, internal channels): `RandError`, `NoteError`, `NoteCommitmentError`, `KeyError`, `AddressError`, `ParametersBuilderError`, `InvalidNetworkError`, `SolverCancelled`, `StateInitError`, `CloneError`, `LayeredStateError`, `ExtraCoinbaseDataTooLong`, `BlockNotifyError`, `BlockGossipError`, `SharedRecvError` (reasons in `scripts/zebra-error-notes.json`).
- Stage: per type from the file it lives in, with per-variant overrides read from call sites (`stageByVariant` in the notes file names each raise site). Counts: state 68, block 63, transaction 59, mempool 44, router 19, rpc 15, proof-signature 11, script 6.
- 52 variants have a written `plain` + `zips` (branch ID, version, expiry, lock time, ZIP 317 fee, missing/duplicate inputs, nullifiers, anchors, scripts, Groth16/Halo 2/RedJubjub/RedPallas, Orchard/Ironwood proof size, NU6.3 Orchard turnstile/flags/coinbase, coinbase maturity/shielding, mempool states, deserialization). The rest say `Zebra reports "<message>" during <stage>.`
- Ambiguous type names are module-qualified, e.g. `transaction::unmined::zip317::Error::UnpaidActions`, `zebra_script::Error::ScriptInvalid`, `zebra_consensus::BlockError::…` vs `block::BlockError::…`.
- Transparent wrappers have `message: "{0}"`.
- `sendrawtransaction` codes (zebra-rpc `methods.rs` 1467+): `-22` deserialization, `-25` any verifier failure, `-1` misc (mempool storage rejections). Mempool verifier errors arrive as `failed to validate tx: WtxId("private"), error: …` (`zebrad/src/components/mempool/downloads.rs:528`, a `format!`, not a catalog entry).

## Regtest rejection samples (`data/zebra-error-samples.json`)

Produced by `scripts/regtest-errors.ts` with Docker image `zfnd/zebra:7.0.0-rc.0` (arm64, same commit as the catalog), ephemeral regtest state, activation `Canopy = 1, NU5 = 1, NU6.3 = 1`, RPC reached through `docker exec … curl` inside the container (no host port published). A fresh random secp256k1 key is the miner address; the script signs v5 transparent transactions itself (`scripts/regtest/transparent-tx.ts`, ZIP 244 sighash, written from `zips/zip-0244.rst`). The control transaction is **accepted** by zebrad, which proves the signer; each other case changes one thing. Two runs: one with default `should_allow_unshielded_coinbase_spends = false`, one with `true`.

| id | change | Zebra answer (top match) |
|---|---|---|
| unshielded-coinbase-spend | coinbase spent to a t-address | -25 `ValidateContextError::UnshieldedTransparentCoinbaseSpend` |
| baseline-accepted | none | accepted |
| already-in-mempool | resend control | -1 `MempoolError::InMempool` |
| mempool-spend-conflict | same input, other fee | -25 `SameEffectsTipRejectionError::SpendConflict` |
| wrong-branch-id | NU6.2 branch ID | -25 `TransactionError::WrongConsensusBranchId` |
| expired | expiry 10 below tip | -25 `TransactionError::ExpiredTransaction` |
| zero-fee / low-fee | fee 0 / 1,000 zat | -25 `zip317::Error::UnpaidActions` |
| wrong-key-signature | signed by another key | -25 `TransactionError::InternalDowncastError` (`Unknown(Script(Interpreter(… OP_EQUALVERIFY …)))`) |
| wrong-prevout-amount | sighash with value +1 zat | -25 `TransactionError::InternalDowncastError` (`original error: ScriptInvalid`) |
| lock-time-height | nLockTime tip+50 | -25 `TransactionError::LockedUntilAfterBlockHeight` |
| missing-input | prevout = mainnet tx absent on regtest | -25 `TransactionError::TransparentInputNotFound` |
| truncated-hex | last 10 bytes cut | -22 `SerializationError::Io` |
| immature-coinbase | coinbase 5 blocks old | -25 `ValidateContextError::ImmatureTransparentCoinbaseSpend` |
| already-mined | resend after mining | -1 `SameEffectsChainRejectionError::Mined` |
| double-spend-mined | conflict after control mined | -25 `TransactionError::TransparentInputNotFound` |

Findings worth showing in the UI: in Zebra 7.0.0-rc.0 a bad transparent signature never surfaces as `TransactionError::Script`; it arrives as `InternalDowncastError` with the script error inside. A double spend of an already-mined transparent output is reported as "could not find transparent input UTXO", not as a double spend.

## Real samples (`data/samples.json`)

Walked the last 400 mainnet blocks (tip 3,525,573), the 120 blocks before NU6.3 activation, and the last 400 testnet blocks, via `GetBlockRange` with all pool types; versions and branch IDs read from `GetTransaction` and checked against `upgrades.json`. Smallest ordinary transaction per category (fewest inputs/outputs/actions).

| label | network | height | txid |
|---|---|---|---|
| v6 Ironwood transfer | main | 3,495,600 | `30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c` |
| Orchard and Ironwood in one transaction | main | 3,525,568 | `1bee124c7e0038efff04947cb106b18e75e33ee08a595f1def84f71548319b62` |
| Orchard after NU6.3 | main | 3,525,366 | `07ea19f20710b409c3139d45b0c26e2c9c77b47deab6f2206aad9722efb438b7` |
| Sapling shielded transfer (v6) | main | 3,525,428 | `4faf6339572e8097d00b2ea176c5d88908a4ef1dda09cf2f063692e008bc5615` |
| Transparent only | main | 3,525,566 | `ee8e51dabcaa1944170fcb030e3edcb48879b1291ef7dd63c1a541a5d1bf2314` |
| Coinbase | main | 3,525,573 | `76ff129faeda1a31fc4c13c8b03274c289df4ebb9d7e9e62f99056256b0c6dbe` |
| v5 Sapling before Ironwood | main | 3,428,136 | `38909f8897d562d94355026631bce2e97233bb27f71ddd8db91e8ec6bf34402b` |
| v5 Orchard before Ironwood | main | 3,428,142 | `e08715bdada7e393d14cf44c29f8b761f539a9683b4cb549047afa933af3a22e` |
| Testnet after NU7 | test | 4,525,648 | `cef858e91c7ec1751cf45c8024c0ed3badb5eae18bce488354c7a1603ad29fac` |

No v5 transaction appeared among the 60 smallest candidates of the last 400 mainnet blocks; everything recent is v6. The "Orchard and Ironwood" sample is labelled by shape only; its value balances were not decoded here (agent A's decoder will show them).

## Network upgrades (`data/upgrades.json`)

From Zebra v7.0.0-rc.0 `zebra-chain/src/parameters/constants.rs` (activation heights) and `network_upgrade.rs:231` (`CONSENSUS_BRANCH_IDS`). Cross-checked: identical heights and branch IDs in librustzcash `components/zcash_protocol/src/consensus.rs` at `8672a4b2d60f432664780e6a4e85f49a36805a2a`, and the live branch ID from both indexers matches the table at their tips (main NU6.3 `0x37a5165b`, test NU7 `0x77190ad9`). Mainnet has no NU7 height. Names follow Zebra's serde names (`Genesis`, `BeforeOverwinter`, …, `NU6.3`, `NU7`); `Genesis` and `BeforeOverwinter` have `branchId: null`.

## For agents A and B

- **ZIP 317 marginal fee differs by node version.** ZIP 317 as written and `zcash_primitives` (`MARGINAL_FEE = 5_000`) vs Zebra 6.4.x and 7.0.0-rc.0 (`MARGINAL_FEE = 1_000`, ZIP 2009); Zebra 6.3.0 still uses 5,000 (checked in each tag's `zebra-chain/src/transaction/unmined/zip317.rs`). `zip317.conventionalFeeZat` from `zcash_primitives` is therefore the conservative 5,000 rate; a fee check that warns below it would warn on fees Zebra 6.4+ accepts. Suggest showing both numbers.
- B: match pasted errors client-side with `matchError` from `apps/web/src/server/match-error.ts` (move it to a shared folder if you prefer; it has no server dependencies). `data/zebra-error-samples.json` gives ready "Why rejected" examples (each `response.message` is a real zebrad string).
- B: `apps/web/package.json`, `tsconfig.json`, `next.config.ts` here are a minimal scaffold for the routes. When merging with your scaffold keep from mine: deps `@grpc/grpc-js`, `@grpc/proto-loader`; `serverExternalPackages` for both; `outputFileTracingIncludes` for `src/server/proto/**`; `outputFileTracingRoot`/`turbopack.root` = repo root (routes import `../../data/*.json` and `contract/types.ts`); `logging.incomingRequests: false`; scripts `test`, `test:live`; dev dep `vitest`. There is no `app/layout.tsx` or page in my branch.
- A: real v6 fixtures (tx + both parents) are in `apps/web/src/server/fixtures/mainnet-transactions.json` if you want them for decoder tests.

## Not done

- No `zebrad` dry-run route (`sendrawtransaction` against a local regtest node from the UI); only the offline catalog + recorded samples.
- Regtest samples cover transparent cases only; no Sapling/Orchard/Ironwood proof or nullifier rejections (needs a shielded builder + proving).
- `ValidateContextError::Duplicate*Nullifier`, anchors, Halo 2 failures have written explanations but no recorded real string.
- `prevouts` stops after 100 distinct parent transactions (remaining inputs get `null`).

## Contract change proposals

1. Add the matcher result type, so B can type against it:
   `export interface ErrorMatch { entry: ZebraErrorEntry; score: number; how: "message" | "variant-name"; wrapsAnotherMatch: boolean }`.
2. Optional: `POST /api/tx` and `POST /api/prevouts` with `{ txid, network }` in the body, so txids stay out of hosting-provider request logs.
