# Handoff: Stall Doctor

Branch `Bimajadivaaa/z-stall`. Not pushed. Checked in Chrome on port 3042 on 2026-10-22.

## What

A browser-only diagnosis view for a stalled Zebra node. The operator pastes zebrad log lines, Prometheus `/metrics`
text or `getblockchaininfo` JSON (or a mix) into the main box. Nothing leaves the tab.

Output, in one "Stall Doctor" panel:

1. **Timeline**: inline SVG of `current_height` over time from the `estimated progress to chain tip` lines, with
   dashed markers for restarts (`Starting zebrad`, `Thank you for running a … zebrad`), verify timeouts (`Elapsed(`,
   `timed out`, `Timeout` on WARN/ERROR lines), other warnings and errors. Without timestamps the x axis is the line
   number. Hover a point or marker for its line.
2. **Checks**: eight signatures, each Hit / Maybe / Not seen / No data, with evidence lines, a plain-English
   explanation, a workaround when hit, and GitHub links.
3. **What to collect next**: `[metrics] endpoint_addr`, `[health]` `/ready` and `/healthy`, `[tracing]` `/filter`,
   and `getblockchaininfo`.
4. **Samples**: three chips on the landing page (`Stall: losing fork`, `Stall: verify timeout`,
   `Metrics: checkpoint gap`).

## How

- `apps/web/src/lib/stall.ts`: pure parser and matcher. `looksLikeNodeOutput` decides routing,
  `diagnoseStall` returns points, markers, metrics, chain info and checks. `STALL_NEXT` holds the hints.
- `apps/web/src/lib/input.ts`: a new `stall` kind, checked right after `empty`. It is chosen when the text has a
  `# TYPE`/`# HELP` line, parses as `getblockchaininfo` JSON (`blocks` plus `bestblockhash` or `chain`, bare or
  inside `result`), or has at least two log lines (an ISO timestamp with a level, or a leading level). A single error
  sentence or a single log line still goes to the Why-rejected catalog.
- `apps/web/src/components/stall-view.tsx`: the timeline and the rows, built from `ui.tsx` (`Inner`, `Dot`, `Chip`,
  `STATUS_TONE`, `ExternalLink`, `EmptyState`) and the same fail/warn-first grouping as `checks-view.tsx`.
- `inspector-app.tsx` has a new `stall` mode, and `input-panel.tsx` has the chips and the routing hint.
- Metrics: dots in Zebra's names become underscores in Prometheus, a trailing `_total` is dropped, and series with
  different labels are summed.
- Tests: `apps/web/src/lib/stall.test.ts` covers routing, the timeline and markers, each signature, and the samples.

## Signatures and where the wording comes from

All strings were checked against Zebra `main` at `c76a867` (2026-10-22).

| Check | Matches | Source |
| --- | --- | --- |
| parent-missing (#11133, fix #11582) | `state must contain parent block to do contextual validation`, `NotReadyToBeCommitted`, `block parent not found in any chain`; `state_memory_chain_count >= 10` | `zebra-state/src/service/check.rs:79`, `error.rs:316`, `MAX_NON_FINALIZED_CHAIN_FORKS = 10` in `constants.rs:107`, gauge in `non_finalized_state.rs:985` |
| behind-tip (#11509, fix #11510) | `queued download of hash behind our chain tip`; Hit when a timeout came first | `zebrad/src/components/sync.rs:921`, logged as `temporary error obtaining tips: …` |
| verify-timeout-near-tip (#11610, open) | timeout markers plus `NotFoundRegistry`, `recently missing these items`, `no (busy) peer that might have the inventory`, or `zcash_net_peer_set_inventory_refusal > 0` | `BLOCK_VERIFY_TIMEOUT` 8 min in `sync.rs:199`; `zebra-network/src/peer/error.rs:142`; `peer_set/set.rs:1429/1817` (debug level) |
| downcast-elapsed (#10494 regression, fixes #10630/#10633) | `downcast to known transaction error type failed` with `Elapsed` | `zebra-consensus/src/error.rs:398` |
| chain-stalled | `chain updates have stalled, state height has not increased`, `initial sync is very slow`, a flat height for 10+ minutes, or getblockchaininfo more than 10 blocks behind `estimatedheight` | `zebrad/src/components/sync/progress.rs:263` |
| tcp-slow-start | `tcp_slow_start_after_idle` or `TCP slow-start-after-idle` | `zebrad/src/commands/start.rs:157` |
| checkpoint-gap | `checkpoint_queued_continuous_height` minus `checkpoint_verified_height` > 800 | `zebra-consensus/src/checkpoint.rs:498/147` |
| low-peers | `zcash_net_peers`: 0 is Hit, under 5 is Maybe | `zebra-network/src/peer_set/set.rs:2141` |

## Limits and unverified items

- The thresholds are ours and Zebra does not confirm them: a checkpoint gap over 800 (twice the 400-block maximum
  checkpoint spacing), fewer than 5 peers, three parent refusals counting as "repeated", and 10 blocks behind the
  estimated tip. Those two checks carry an "unverified threshold" chip.
- Workaround claims we have not seen confirmed in the issues: that a restart clears the stale forks (#11133) and
  restarts a stuck syncer (#11509), and the `checkpoint_verify_concurrency_limit` advice for the checkpoint gap.
- The sample logs were assembled from the source, not captured from a running node. The exact `?e` Debug rendering of
  a verify timeout (`ValidationRequestError { error: Elapsed(()), … }`) is inferred from the code.
- The `NotFoundRegistry` refusal lines are debug level, so in a default INFO log only the metric shows them.
- The timeline only plots progress lines. A metrics-only paste shows an empty state in its place.
- Timestamps are the first ISO date-time on a line (so journald or docker prefixes are fine), read as UTC unless the
  line has an offset. Lines without one fall back to line order.
- No Ask AI and no Copy as issue for this mode yet.
