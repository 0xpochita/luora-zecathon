# HANDOFF: agent A, `crates/core` (librustzcash → WASM)

Branch `Bimajadivaaa/z-core`. Not pushed. Nothing outside `crates/core/**` and `apps/web/public/wasm/**` was changed.

## What works

- **WASM in the browser.** `apps/web/public/wasm/` is committed (`luora_z_core.js`, `luora_z_core_bg.wasm`, `.d.ts`). The Next.js app needs no Rust toolchain. Checked in Chrome from a test page on port 3033: v6 Ironwood decode and all ten checks take about 7 ms.
- **All five contract functions** from `contract/types.ts`: `decode_tx`, `check_tx`, `fee_zat`, `inspect_pczt`, `upgrade_at`.
- **Native CLI** `luora-z decode|check|fee|pczt|upgrade` built from the same code, plus `verify` (stretch goal, native only).
- **Tests.** 18 golden tests on real fixtures (`cargo test`), plus 2 proof tests with `--features verify`. Every fixture's txid round-trips through ZIP 244 (`tx.txid()`).
- **Stretch goal (provers).** `luora-z verify <hex>` checks Orchard and Ironwood Halo 2 proofs, using the circuit key picked by the bundle version (InsecurePreNu6_2 / FixedPostNu6_2 / PostNu6_3). It also checks Sapling Groth16 spend and output proofs against the Sapling parameters, which `zcash_proofs` downloads and hash-checks. Every real proof verifies, and a proof with one byte flipped fails.

## Commands

```sh
cd crates/core
cargo test                                   # 18 golden tests, real fixtures only
cargo test --release --features verify --test verify   # Halo 2 + Groth16 (downloads Sapling params once, ~50 MB)
cargo build --release
target/release/luora-z decode --network main <HEX>
target/release/luora-z check  --network main --height 3495600 --inputs 509384,595000 <HEX>
target/release/luora-z fee    --inputs 509384,595000 <HEX>       # use null for an unknown input value
target/release/luora-z pczt   --network test <HEX-or-BASE64>
target/release/luora-z upgrade --network main --height 3428143
cargo build --release --features verify && target/release/luora-z verify <HEX>
# "-" in place of HEX reads stdin

# rebuild the WASM (from the repo root)
cargo install wasm-pack
wasm-pack build crates/core --target web --out-dir ../../apps/web/public/wasm --release
rm apps/web/public/wasm/.gitignore            # wasm-pack writes "*" there; delete it so the output stays committed
```

The WASM build compiles `secp256k1-sys` C code, and Apple clang has no wasm32 target. `crates/core/.cargo/config.toml` points `CC_wasm32_unknown_unknown` at Homebrew LLVM (`/opt/homebrew/opt/llvm/bin/clang`, `brew install llvm`). On another machine, change that path or set the env var. Native builds are unaffected. Toolchain used: rustc 1.99.1 stable, wasm-pack 0.15.0 / wasm-bindgen 0.2.129.

## JS usage

```ts
import init, { decode_tx, check_tx, fee_zat, inspect_pczt, upgrade_at } from "/wasm/luora_z_core.js";
await init();
const tx = decode_tx(hex, "main");
const checks = check_tx(hex, "main", height, inputValues);   // inputValues: (number|null)[], one per transparent input
const fee = fee_zat(hex, inputValues);                       // null if any value unknown, or for a coinbase
const view = inspect_pczt(base64OrHex, "test");
const nu = upgrade_at("main", 3428143);                      // { name: "NU6.3", branchId: "0x37a5165b", activationHeight: 3428143 }
```

Errors are thrown as `{ code, message }`. The codes are `empty-input`, `bad-hex`, `too-large`, `too-short`, `parse-failed`, `trailing-bytes`, `bad-network`, `bad-input-values`, `input-values-mismatch` (fee_zat only), `fee-out-of-range`, `bad-encoding`, `not-pczt`, `pczt-parse-failed` and `pczt-invalid`. Results use JSON-compatible serialization: `null` for absent values, plain numbers, plain objects.

## Versions and sizes

- librustzcash `main` at rev `8672a4b2d60f432664780e6a4e85f49a36805a2a` (2026-10-20), pinned in `crates/core/Cargo.toml`: `zcash_primitives 0.31.0-pre.2`, `zcash_protocol 0.11.0-pre.1` (+ `local-consensus`), `zcash_address 0.14.0-pre.2`, `zcash_transparent 0.11.0-pre.2`, `pczt 0.10.0-pre.2` (features `orchard`, `sapling`, `transparent`), `zcash_proofs 0.31.0-pre.2` (verify feature only).
- `orchard 0.16.0` and `sapling-crypto 0.9.0` without `circuit` or `multicore`; the `verify` feature turns on `orchard/circuit` for the native CLI only. Also `halo2_proofs 0.4.0`, `groth16 0.2.0`, `bellman 0.15.0` (verify only), `wasm-bindgen 0.2.129`, `serde-wasm-bindgen 0.6.5`.
- Zebra source cited in check `source` fields: commit `6d1e414d` (tag `v7.0.0-rc.0`).
- WASM size is 690 KB raw and about 380 KB gzipped, with `opt-level = "z"`, `lto`, `codegen-units = 1`, `panic = "abort"` and wasm-opt from wasm-pack. The budget was 3 MB.
- Timings on an M-series laptop. Halo 2 verifying key build: about 2.8 s per circuit version. Halo 2 bundle verify: 30–50 ms. Groth16 per proof: 2–3 ms.

## Real data used

All fixtures live in `crates/core/tests/fixtures/`; `README.md` there says how each was made. The transactions were fetched with `fetch.py` (grpcurl → lightwalletd `GetTransaction`).

| Fixture | txid | height | endpoint |
|---|---|---|---|
| v4 transparent | `56b2017fa84f90afb1f0a4cc34ee7af32657939422f3d57fb54dc4486224e54b` | 1,000,000 | zec.rocks:443 |
| v4 coinbase | `8e5230ddfad5c02b201c52fd4380bd0574784f00368e6795c5d07b0e3967f874` | 1,000,000 | zec.rocks:443 |
| v5 Sapling | `9f32bdbe0dd4033a12cfe091d6ef3bf65f21a413510d5920112101a7a3abde92` | 2,700,002 | zec.rocks:443 |
| v5 Orchard (pre-NU6.3) | `5f1c6bfa4e97c9aa5e918b6912dc70cb7a46aee01d91599bdb8e657306650e0a` | 2,900,000 | zec.rocks:443 |
| v6 Ironwood | `30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c` | 3,495,600 | zec.rocks:443 |
| v6 coinbase into Ironwood | `59e2314af4706aca7d40a303e80d960834dc3aecd1282c0bd397eb8b64f975f9` | 3,520,002 | zec.rocks:443 |
| v6 testnet tx built from our PCZTs | `7b596d3aba75831e5f23badb93dfb9bc6da5d7b8531a3eed154e0f3ec1e362fa` | 4,525,648 (testnet, NU7) | testnet.zec.rocks:443 |

Both endpoints worked on 2026-10-21. `GetLightdInfo` on mainnet reported Zebra 6.3.0, branch `37a5165b` and height 3,525,539.

Every fixture also stores `transparentInputValuesZat`, the real prevout values fetched the same way. This lets the UI and agent C show a real fee. Good samples for `data/samples.json`: the six mainnet txids above, plus the testnet one.

**PCZTs** (`tests/fixtures/pczt/1-created … 5-combined-signed.pczt`). These are real PCZTs from `zcash-devtool` (commit `0b3436bb`) on testnet. A throwaway wallet was funded with 1 TAZ by the Fauzec faucet (funding txid `a8b57276a17069f4ce866fa1d4a32011c44a9dc36c62c5abc17386a202173753`). The PCZT is saved after each of these stages: create, prove, sign, combine. The combined PCZT was broadcast as `7b596d3a…62fa`.

**Real finding while making them.** The unmodified `zcash-devtool pczt sign` silently skips Ironwood spends. It returned the PCZT byte for byte unchanged, `pczt combine` accepted it, and `pczt send` then failed with `Pczt(Extraction(Ironwood(Extract(MissingSpendAuthSig))))`. That is the #2768 failure shape, live on the new pool. `4-combined-unsigned.pczt` is that artefact. Luora flags it before extraction: `all-signatures-present` → warn, "Ironwood action 3". This makes a good demo moment for the video. The signed fixture came from a local, uncommitted devtool patch that also calls `Signer::sign_ironwood`. Worth reporting upstream to zcash-devtool if the user agrees; I have not filed anything.

## Checks implemented (`check_tx`)

Every check carries `zip` (number, clause text, URL) and `source` (file:line in Zebra `6d1e414d` or librustzcash `8672a4b2`). Each `detail` uses the transaction's real numbers.

| id | rule | source |
|---|---|---|
| `branch-id` | v5+: nConsensusBranchId == `BranchId::for_height`. v4: `na`, because v4 has no field | zebra-consensus/src/transaction/check.rs:885 |
| `version` | `TxVersion::valid_in_branch` (v6 needs NU6.3; v4 is invalid from NU7, ZIP 2003) | zcash_primitives/src/transaction/mod.rs:235 |
| `expiry` | non-coinbase: 0 or height ≤ expiry, and ≤ 499,999,999. Coinbase from NU5: expiry == height (ZIP 203) | check.rs:506, :547 |
| `reserved-flags` | flag bytes shown, reserved bits zero (the parser already rejects nonzero ones) | orchard 0.16 src/bundle.rs:400 |
| `orchard-turnstile` | from NU6.3, valueBalanceOrchard ≥ 0 (ZIP 258) | check.rs:217 |
| `orchard-cross-address` | from NU6.3, Orchard actions must use the NU6.3 circuit with enableCrossAddress = 0 (ZIP 258) | check.rs:184 |
| `orchard-after-nu62` | ZIP 257 window 3,363,426 … NU6.2−1 (testnet 4,048,500 …): v5+ txs must have no Orchard actions | zebra-chain/src/parameters/network.rs:26, zebra-consensus/src/transaction.rs:850 |
| `proof-length` | Halo 2 proof == 2720 + 2272·n. Orchard enforced from NU6.2 (`warn` before), Ironwood always | transaction.rs:873, :884 |
| `coinbase-shielded` | no JoinSplits or shielded spends; enableSpends 0; no Orchard component from NU6.3 (ZIP 213/229/258) | check.rs:277, :246 |
| `zip317-fee` | fee from `fee_paid` vs `FeeRule::standard().fee_required`; `warn` if below, `na` if an input value is unknown or it is a coinbase | fees/zip317.rs:172, transaction/mod.rs:677 |

`inspect_pczt` reads the PCZT through the `pczt` crate (`Pczt::parse` + the `Verifier` role). It reports the nine contract roles, each with evidence taken from the fields. Its checks are `user-address-matches-recipient` (librustzcash#3155, which also checks the address network), `dummy-keys-cleared`, `all-signatures-present` (#2768) and `fee-and-expiry` (devtool #146/#243). It adds an extra `coin-type` warning when `Global.coin_type` does not match the selected network.

## Contract notes and proposed changes

1. **Proposed addition:** `PcztView.actions[].kind: "input" | "output" | "action"`. It is already emitted. Without it the UI cannot tell a transparent input from a transparent output, or a Sapling spend from a Sapling output, since both share `pool` and `index`. Orchard and Ironwood entries are `"action"` and describe the action's output (value, recipient, user_address) plus the spend's signature.
2. Roles that cannot be observed in a single PCZT: `Combiner` is always `done: false`, with evidence saying why. `Extractor` is always `done: false`, and its evidence says "ready to extract" or lists what is missing.
3. Byte order follows Zebra's `getrawtransaction` rendering, which matches zcashd. txids, prevTxid, all anchors and the Sapling nullifiers and cmu are reversed (display order). Orchard and Ironwood nullifiers and cmx are in wire order, as Zebra prints them.
4. `consensusBranchId` and `upgrade` are `null` for v4 and older transactions, because the field does not exist there. `crossAddressEnabled` is `null` for v5 Orchard bundles, because the bit does not exist there.
5. `upgrade` names are the `zcash_protocol` `NetworkUpgrade` Display string, with `Nu` written as `NU` (`"NU6.3"`, `"NU5"`, `"Canopy"`).
6. `zip.clause` is the ZIP section or rule text, not a URL anchor. `zip.url` is the ZIP page.
7. Regtest uses `zcash_protocol::local_consensus::LocalNetwork` with every upgrade through NU6.3 active from height 1 and NU7 off. A regtest node can be configured differently; if agent C's regtest setup uses other heights, this needs a parameter.

## Not done / limits

- No Sprout/JoinSplit field in `DecodedTx`; the contract has none. JoinSplits do count in the ZIP 317 logical actions.
- `coinbase-shielded` does not do the "decrypts with the all-zero OVK" part; that needs note plaintexts. The detail says so.
- `verify` checks proofs only, not spend-auth or binding signatures, because those need the sighash and therefore every transparent prevout amount and script. It is native-only and not in the WASM build.
- No PCZT that fails the `user_address` check exists as a fixture: making one would mean forging a PCZT, which the real-data rule forbids. The check is covered by its pass path on real PCZTs and by code review.
- The wasm-bindgen generated JS in `apps/web/public/wasm/` contains a few generated comments. It is build output, not hand-written code.

## Trace (`trace_tx`, added on `Bimajadivaaa/z-ux`)

`trace_tx(hex, network) -> TraceNode[]` (WASM, `luora_z_core::trace_tx`, CLI `luora-z trace`) returns the transaction's own
structure in serialisation order. Every node is a real byte range of the raw transaction:
`{ id, parentId, depth, kind, label, offset, length, fields: { name, value, display, encrypted? }[] }`
(`contract/types.ts` → `TraceNode`). `value` is the raw field (hex of the bytes as serialised, or a number),
`display` a short form, `encrypted: true` marks note ciphertexts, which are never decoded.

How the offsets are found (`crates/core/src/trace.rs`): the transaction is first parsed by `zcash_primitives`
(`Transaction::read`); a cursor then walks the same bytes, reading every CompactSize from the bytes and checking each count
against the parsed transaction, and taking fixed sizes for the rest. The walk must end exactly at the last byte, otherwise
`trace-failed`. Layouts followed (cross-checked against the librustzcash writers at the pinned rev):

| Part | Layout | Source |
|---|---|---|
| v4 header (8 B), transparent, lockTime, expiryHeight, valueBalanceSapling, vSpendsSapling (384 B each), vOutputsSapling (948 B each), vJoinSplit, bindingSigSapling | Protocol spec §7.1 "Transaction Encoding and Consensus" (v4) | `zcash_primitives/src/transaction/mod.rs` `read_v4`, `components/sapling.rs` `read_spend_v4` / `read_output_v4` |
| v5 header (20 B), transparent, Sapling (spends 96 B, outputs 756 B, valueBalance, anchor, proofs 192 B, spendAuthSigs 64 B, output proofs, bindingSig), Orchard (actions 820 B, flags, valueBalance, anchor, CompactSize proof, spendAuthSigs, bindingSig) | ZIP 225 "Version 5 Transaction Format" | `mod.rs` `read_v5`, `sapling.rs` `read_v5_bundle`, `orchard.rs` `read_bundle` |
| v6: as v5, then a second Orchard-shaped bundle for Ironwood | ZIP 229 "Version 6 Transaction Format" | `mod.rs` `read_v6`, `orchard.rs` `read_v6_bundle` |

Sprout JoinSplits and transactions before v4 are not traced (`trace-unsupported`); no real sample needs them.

Tests (`crates/core/tests/trace.rs`, all 7 real fixtures): top-level nodes tile `[0, sizeBytes)` with no gap and the last
one ends at `sizeBytes`; every child lies inside its parent in byte order with `depth = parent + 1`; the bytes of each
bundle node equal librustzcash's own serialisation of that bundle (`write_transparent`, `write_v5_header` /
`write_v6_header`, `write_v5_sapling`, `orchard::write_v5_bundle` / `write_v6_bundle`; whole-tx `write_v4` for v4);
every `vin-i` / `vout-i` slice equals `TxIn::write` / `TxOut::write`; nullifier and cmx fields equal the parsed actions;
ciphertexts are flagged encrypted. Example (v6 Ironwood `30cdd41f…021c`, 6,340 B): header 0–20, transparent 20–352,
Sapling 352–354 (empty), Orchard 354–355 (empty), Ironwood 355–6340 with action 356–1176 (820 B) and Halo 2 proof
1217–6212 (CompactSize + 4,992 B).

Byte order note: trace fields show bytes as they sit in the transaction. The drawer's `anchor` (from `decode_tx`) is in
display order (reversed), so the same anchor reads differently in the two places. Prevout txids in VIN rows use display
order, as explorers do.

The WASM in `apps/web/public/wasm/` was rebuilt with `wasm-pack build crates/core --target web --out-dir
../../apps/web/public/wasm --release` (713 KB raw).
