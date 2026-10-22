export const SAMPLE_CHIPS: Record<string, string> = {
  "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c": "Ironwood transfer",
  "1bee124c7e0038efff04947cb106b18e75e33ee08a595f1def84f71548319b62": "Orchard to Ironwood",
  "4faf6339572e8097d00b2ea176c5d88908a4ef1dda09cf2f063692e008bc5615": "Sapling payment",
  "a52e4025b46e63a092d74897e9b0a62bbade3317f748a9f668a31d44c8757fdb": "Coinbase reward",
};

export const ERROR_CHIP = {
  label: "Rejected: expired",
  text: "TransactionError::ExpiredTransaction",
  why: "A Zebra error variant name, as it appears in zebra-consensus/src/error.rs and in Zebra's logs.",
};

const MAIN = '{zebrad="c76a867" net="Main"}';
const TEST = '{zebrad="c76a867" net="Test"}';
const PROGRESS = "zebrad::components::sync::progress: estimated progress to chain tip";
const HASH = 'block::Hash("0000000004c2f3b1d6a9e0c7f58e2b1a63d4c9e8f7a6b5c4d3e2f1a0b9c8d7e6")';

export const STALL_CHIPS = [
  {
    label: "Stall: losing fork",
    why: "Zebra logs plus one /metrics line: parent-block refusals repeat and the non-finalized chain count sits at 10 (issue #11133).",
    text: [
      `2026-10-21T08:00:03.412Z  INFO ${MAIN}: ${PROGRESS} sync_percent=99.998% current_height=Height(3524180) network_upgrade=Nu6_1 remaining_sync_blocks=6 time_since_last_state_block=48s`,
      `2026-10-21T08:01:12.904Z  WARN ${MAIN}: zebra_state::service::check: state must contain parent block to do contextual validation finalized_tip_height=Some(Height(3524080))`,
      `2026-10-21T08:03:40.118Z  WARN ${MAIN}: zebra_state::service::check: state must contain parent block to do contextual validation finalized_tip_height=Some(Height(3524080))`,
      `2026-10-21T08:05:03.551Z  INFO ${MAIN}: ${PROGRESS} sync_percent=99.996% current_height=Height(3524180) network_upgrade=Nu6_1 remaining_sync_blocks=10 time_since_last_state_block=5m 48s`,
      `2026-10-21T08:07:22.030Z  WARN ${MAIN}: zebrad::components::sync: error downloading and verifying block e=ValidationRequestError { error: NotReadyToBeCommitted, height: Height(3524183), hash: ${HASH} }`,
      `2026-10-21T08:10:03.640Z  INFO ${MAIN}: ${PROGRESS} sync_percent=99.994% current_height=Height(3524180) network_upgrade=Nu6_1 remaining_sync_blocks=14 time_since_last_state_block=10m 48s`,
      `2026-10-21T08:10:03.641Z  WARN ${MAIN}: zebrad::components::sync::progress: chain updates have stalled, state height has not increased for 10 minutes. Hint: check your network connection, and your computer clock and time zone sync_percent=99.994% current_height=Height(3524180)`,
      `2026-10-21T08:12:51.207Z  WARN ${MAIN}: zebra_state::service::check: state must contain parent block to do contextual validation finalized_tip_height=Some(Height(3524080))`,
      `2026-10-21T08:15:03.702Z  INFO ${MAIN}: ${PROGRESS} sync_percent=99.991% current_height=Height(3524180) network_upgrade=Nu6_1 remaining_sync_blocks=18 time_since_last_state_block=15m 48s`,
      "# TYPE state_memory_chain_count gauge",
      "state_memory_chain_count 10",
    ].join("\n"),
  },
  {
    label: "Stall: verify timeout",
    why: "Testnet zebrad logs near the tip: an 8-minute verify timeout, refused block requests, re-queued hashes behind the tip, then a restart (issues #11610 and #11509).",
    text: [
      `2026-10-20T14:00:11.020Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.741% current_height=Height(4417801) network_upgrade=Nu6_1 remaining_sync_blocks=11460 time_since_last_state_block=4s`,
      `2026-10-20T14:05:11.044Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.753% current_height=Height(4417933) network_upgrade=Nu6_1 remaining_sync_blocks=10928 time_since_last_state_block=2m 35s`,
      `2026-10-20T14:07:40.311Z DEBUG ${TEST}: zebra_network::peer_set::set: no peer that might have the inventory can take the request, failing request hash=Block(${HASH})`,
      `2026-10-20T14:09:02.873Z DEBUG ${TEST}: zebra_network::peer_set::set: no busy peer that might have the inventory became ready, failing request hash=Block(${HASH})`,
      `2026-10-20T14:10:11.068Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.751% current_height=Height(4417933) network_upgrade=Nu6_1 remaining_sync_blocks=10995 time_since_last_state_block=7m 35s`,
      `2026-10-20T14:10:36.502Z  WARN ${TEST}: zebrad::components::sync: error downloading and verifying block e=ValidationRequestError { error: Elapsed(()), height: Height(4417934), hash: ${HASH} }`,
      `2026-10-20T14:10:36.503Z  INFO ${TEST}: zebrad::components::sync: waiting to restart sync timeout=67s state_tip=Some(Height(4417933))`,
      `2026-10-20T14:11:43.610Z  INFO ${TEST}: zebrad::components::sync: temporary error obtaining tips: queued download of hash behind our chain tip`,
      `2026-10-20T14:15:11.090Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.749% current_height=Height(4417933) network_upgrade=Nu6_1 remaining_sync_blocks=11062 time_since_last_state_block=12m 35s`,
      `2026-10-20T14:15:11.091Z  WARN ${TEST}: zebrad::components::sync::progress: chain updates have stalled, state height has not increased for 10 minutes. Hint: check your network connection, and your computer clock and time zone`,
      `2026-10-20T14:18:02.400Z  INFO zebrad::commands::start: Starting zebrad`,
      `2026-10-20T14:18:02.950Z  WARN zebrad::commands::start: TCP slow-start-after-idle is enabled, which resets TCP's congestion window between block requests and significantly reduces single-peer throughput for block propagation. setting="net.ipv4.tcp_slow_start_after_idle"`,
      `2026-10-20T14:21:12.330Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.760% current_height=Height(4418120) network_upgrade=Nu6_1 remaining_sync_blocks=10612 time_since_last_state_block=3s`,
      `2026-10-20T14:26:12.402Z  INFO ${TEST}: ${PROGRESS} sync_percent=99.788% current_height=Height(4419310) network_upgrade=Nu6_1 remaining_sync_blocks=9380 time_since_last_state_block=1s`,
    ].join("\n"),
  },
  {
    label: "Metrics: checkpoint gap",
    why: "A Prometheus /metrics excerpt from a node still in checkpoint sync, with few peers and verification far behind the download queue.",
    text: [
      "# TYPE checkpoint_queued_continuous_height gauge",
      "checkpoint_queued_continuous_height 2412000",
      "# TYPE checkpoint_verified_height gauge",
      "checkpoint_verified_height 2398400",
      "# TYPE zcash_net_peers gauge",
      'zcash_net_peers{network="Mainnet"} 3',
      "# TYPE state_memory_chain_count gauge",
      "state_memory_chain_count 1",
      "# TYPE zcash_net_peer_set_inventory_refusal counter",
      'zcash_net_peer_set_inventory_refusal{kind="instant",network="Mainnet"} 0',
    ].join("\n"),
  },
];
