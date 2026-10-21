# Fixtures

Every fixture is real chain data. Nothing here is invented.

## Transactions (mainnet)

Fetched with `fetch.py` from the lightwalletd endpoint `zec.rocks:443`
(`cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction`, protocol files from
`zcash/lightwallet-protocol`). Each JSON file stores `txid`, mined `height`, `endpoint`,
raw `hex` and `transparentInputValuesZat` (the value of each spent transparent output,
read from the previous transaction fetched from the same endpoint; `null` for a coinbase
input).

| File | txid | height | what it is |
|---|---|---|---|
| `v4-transparent.json` | `56b2017fa84f90afb1f0a4cc34ee7af32657939422f3d57fb54dc4486224e54b` | 1,000,000 | v4, 1 transparent input, 2 outputs |
| `v4-coinbase.json` | `8e5230ddfad5c02b201c52fd4380bd0574784f00368e6795c5d07b0e3967f874` | 1,000,000 | v4 coinbase, transparent outputs only |
| `v5-sapling.json` | `9f32bdbe0dd4033a12cfe091d6ef3bf65f21a413510d5920112101a7a3abde92` | 2,700,002 | v5 (NU5), 1 Sapling spend, 2 Sapling outputs, 48 transparent outputs |
| `v5-orchard.json` | `5f1c6bfa4e97c9aa5e918b6912dc70cb7a46aee01d91599bdb8e657306650e0a` | 2,900,000 | v5 (NU6), 2 Orchard actions unshielding to 1 transparent output |
| `v6-ironwood.json` | `30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c` | 3,495,600 | v6 (NU6.3), 2 transparent inputs shielded into 1 Ironwood action (shown as "0.0 ZEC" by explorers, lifinance/data-types#281) |
| `v6-coinbase-ironwood.json` | `59e2314af4706aca7d40a303e80d960834dc3aecd1282c0bd397eb8b64f975f9` | 3,520,002 | v6 coinbase paying into 2 Ironwood actions |

Re-create or add one:

```sh
git clone https://github.com/zcash/lightwallet-protocol /tmp/luora-z-src/lightwallet-protocol
python3 fetch.py scan main 3520000 3520010
python3 fetch.py save main <name> "<label>" <txid>
cargo build && python3 fetch.py prevouts <name>
```

`fetch.py` needs `grpcurl` and reads the proto files from `$LIGHTWALLET_PROTO`
(default `/tmp/luora-z-src/lightwallet-protocol/walletrpc`).

## Testnet transaction and PCZTs

`v6-testnet-ironwood-pczt.json`: txid
`7b596d3aba75831e5f23badb93dfb9bc6da5d7b8531a3eed154e0f3ec1e362fa`, testnet height 4,525,648
(branch NU7), fetched from `testnet.zec.rocks:443`. It is the transaction extracted from the
PCZTs below.

The PCZTs in `pczt/` were made on 2026-10-21 with `zcash-devtool` (commit `0b3436bb`,
librustzcash `eb38d7a3`) and a throwaway testnet wallet funded with 1 TAZ by the Fauzec faucet
(funding txid `a8b57276a17069f4ce866fa1d4a32011c44a9dc36c62c5abc17386a202173753`). The wallet
paid 0.1 TAZ to its own Unified Address:

```sh
zcash-devtool wallet -w W init --name luora-z-fixtures -i W/key.txt -n test
zcash-devtool wallet -w W sync
zcash-devtool pczt -w W create --address <own UA> --value 10000000 --memo "Luora Z PCZT fixture" --output created.pczt
zcash-devtool pczt -w W prove < created.pczt > proven.pczt
zcash-devtool pczt -w W sign --identity W/key.txt < created.pczt > signed.pczt
zcash-devtool pczt combine -i signed.pczt -i proven.pczt > combined.pczt
zcash-devtool pczt -w W send < combined.pczt
```

| File | Stage |
|---|---|
| `1-created.pczt` | after `pczt create` (Creator, Constructor, IO Finalizer, Updater) |
| `2-proven.pczt` | after `pczt prove` (Halo 2 proof for the Ironwood bundle) |
| `3-signed.pczt` | after `pczt sign` with Ironwood signing added (see below) |
| `4-combined-unsigned.pczt` | `combine` of `2-proven` and the output of the unmodified `pczt sign` |
| `5-combined-signed.pczt` | `combine` of `2-proven` and `3-signed`; this one was sent |

Finding while making them: the unmodified `zcash-devtool pczt sign` (commit `0b3436bb`) walks
Orchard, Sapling and transparent spends but not Ironwood ones, so it returned the PCZT byte for
byte unchanged with no error. `pczt combine` merged it without complaint, and `pczt send` then
failed with `Pczt(Extraction(Ironwood(Extract(MissingSpendAuthSig))))`. That is the same failure
shape as librustzcash#2768. `4-combined-unsigned.pczt` is that real artefact, and Luora Z's
`all-signatures-present` check flags "Ironwood action 3" before extraction. To produce
`3-signed.pczt` the local devtool checkout was patched to also call `Signer::sign_ironwood` with
the account's Orchard-protocol spend authorizing key (the patch was not committed anywhere).

The wallet is a throwaway testnet wallet; the PCZTs contain its key derivation metadata and
witnesses, which is harmless on testnet.
