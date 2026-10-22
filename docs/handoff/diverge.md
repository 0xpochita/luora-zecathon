# Handoff: chain divergence watcher (`/chains`)

Branch `Bimajadivaaa/z-diverge`. Not pushed. Checked live on 2026-10-22 against every allowlisted endpoint, and in Chrome
on port 3043.

Background: Zebra #11675 says that a consensus divergence between Zebra and Zakura shows first as two nodes following
different chains, and that nothing watches for that today. `/chains` compares the public lightwalletd and Zaino
backends.

## What works

- **Page** `/chains` (`apps/web/src/app/chains/page.tsx`, `components/chain-watch.tsx`). It is linked as **Chains** in the
  top bar, next to About. Mainnet and Testnet tabs, a **Refresh** button, and an automatic refresh every 30 s. Each backend
  shows its label and host, a status chip (agree / lagging N blocks / diverged at H / unreachable), the lightwalletd
  vendor and version, the node from the subversion string (`Zebra 6.3.0`, `Zakura 1.7.0`; Zaino reports none, shown as
  "node not reported"), the tip height and hash, the latency and the number of block lookups. When a backend has
  diverged, both block hashes at the fork height are shown with copy buttons.
- **Route** `GET /api/chain/compare?network=main|test` (`app/api/chain/compare/route.ts`). The parameter name matches
  `/api/chain`. Regtest and any other value are rejected by `parseNetwork` and `compareEndpoints`.
- **Allowlist** `compareEndpoints()` in `server/networks.ts`. It is fixed in the code, and the route accepts no host from
  the request, so the route cannot be used for SSRF. Every entry was checked with a real `GetLightdInfo` call:

  | Network | Host | Software on 2026-10-22 |
  | --- | --- | --- |
  | main | `zec.rocks`, `na.` / `eu.` / `sa.` / `ap.zec.rocks` :443 | ECC lightwalletd v0.5.3 · Zebra 6.3.0 |
  | main | `eu.zec.stardust.rest`, `us.zec.stardust.rest` :443 | ECC lightwalletd v0.5.5 · Zakura 1.7.0 |
  | main | `lightwalletd.mainnet.cipherscan.app:443` | ECC lightwalletd v0.5.3 · Zakura 1.7.0-modified |
  | main | `mainnet.zainod.zingolabs.dev:443` | Zaino 0.11.0-alpha.4 (no node reported) |
  | main | `mainnet.lightwalletd-rs-beta.zecdev.org:443` | lightwalletd-rs 0.2.0 · Zebra 6.4.2 |
  | main | `zcash.mysideoftheweb.com:9067` | ECC lightwalletd v0.5.4 · Zebra 6.3.0 |
  | test | `testnet.zec.rocks:443` | ECC lightwalletd v0.5.4 · Zebra 7.0.0-rc.0 |
  | test | `testnet.lightwalletd-rs-beta.zecdev.org:443` | lightwalletd-rs 0.2.0 · Zebra 6.4.2 |

  These were tried and dropped: `mainnet.lightwalletd.com`, `testnet.lightwalletd.com`, `lwd1`–`lwd8.zcash-infra.com`,
  `zec.leoninedao.org`, `na.` / `eu2.` / `jp.zec.stardust.rest` and `zaino.zec.rocks` (DNS does not resolve);
  `lightwalletd.testnet.electriccoin.co:9067` (times out); `lwd.zec.pro` (HTTP 521);
  `lightwalletd.testnet.cipherscan.app` (TLS ALPN refused); `zcash.mysideoftheweb.com:19067` (connection refused).
- **Comparison** `compareBackends()` in `apps/web/src/lib/diverge.ts`. It is pure: the endpoints are passed in as
  `BackendSource` objects, and `backendSource()` in `server/indexer.ts` builds them over gRPC.
  1. Every backend is asked for `GetLightdInfo` and `GetLatestBlock` in parallel, with a 5 s deadline per call and one
     retry when the call fails with UNAVAILABLE or DEADLINE_EXCEEDED. A backend that reports another chain name counts as
     unreachable, and the error says which chain it serves.
  2. The reference is the first reachable backend in allowlist order (`zec.rocks` or `testnet.zec.rocks`).
  3. For each other backend, the block hash at the shared height `min(tips)` is compared with the reference. If the
     hashes match, the backends are on one chain. If they differ, the floor `shared - 1000` is checked. A difference at
     the floor too means the fork is deeper than the window, shown as "diverged at or below H". Otherwise a binary search
     runs between the floor and the shared height. The search stops at 40 lookups per pair; the reference's lookups count
     toward that limit even when they are cached. A 1,000-block window needs about 24 lookups.
  4. The lag is the highest tip among the backends on the reference chain minus this backend's tip, so the reference
     itself can show as lagging.
- **Repeat requests**: the route reuses a result for 20 s per network and sends `Cache-Control: public, max-age=15,
  s-maxage=20`. Many open tabs therefore do not multiply the load on the public endpoints.

## Live finding

On 2026-10-22 the two testnet backends follow different chains. `testnet.zec.rocks` (Zebra 7.0.0-rc.0, tip 4,529,044)
and `testnet.lightwalletd-rs-beta.zecdev.org` (Zebra 6.4.2, tip 4,417,161, which is not advancing) first differ at
height **4,416,798**:

- zec.rocks: `00165e6b6c9b603d6f8763b21a47c09bb5c785fc0d14ca1c50d714a4eaad4ffe`
- lightwalletd-rs: `003e532691b131ecfefdfd87a2102fd5731d7dcb146862e6f3d4d5727aab5db3`

The page finds this fork with 23 lookups. A full binary search from height 3,000,000 found the same height. The cause is
not known: it could be a consensus difference between Zebra 6.4.2 and 7.0.0-rc.0, or a stalled minority chain. The page
reports only the hashes.

All 11 mainnet backends agreed (tip 3,526,694).

## Tests

- `src/lib/diverge.test.ts` (11 tests, fake endpoints): agree; lag, including a lagging reference; an exact fork with the
  lookup count bounded; a fork at the shared tip; a fork deeper than the window; a range when the budget runs out;
  unreachable and wrong-chain backends skipped as reference; nothing reachable; latency; status text; node name.
- `src/server/diverge.live.test.ts` is skipped unless `LIVE=1`. It checks that at least two mainnet backends answer and
  none has diverged.

## Limits and unverified items

- The reference is chosen by allowlist order, not by majority. If `zec.rocks` itself forked, every other backend would
  show as diverged. Comparing every pair or voting would fix this; it was left out to keep the lookup count bounded.
- Forks deeper than 1,000 blocks below the shared tip are reported as "at or below", not with the exact height.
- Only backend tips and block hashes are compared. A node that is still syncing, or a lightwalletd whose cache lags its
  node, looks like lag, not divergence. Mempool and transaction-level differences are not checked.
- A manual refresh within 20 s of the previous request gets the reused result. The time shown on the panel is when the
  result was actually fetched.
- The page uses flex-wrap and truncation for phone widths, but it was checked only at desktop width. The browser window
  was not resized.
- The endpoint list can go stale. Re-run a `GetLightdInfo` probe and edit `COMPARE_TARGETS` in `networks.ts`.
