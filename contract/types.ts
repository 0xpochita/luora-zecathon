// Shared JSON contract between crates/core (WASM), apps/web UI and apps/web server routes.
// Change only by agreement; see HANDOFF.md of the worktree that proposes a change.
// All amounts in zatoshi (1 ZEC = 100_000_000 zat). All hashes lowercase hex, display byte order (as explorers show txids).
export type Network = "main" | "test" | "regtest";

export interface OrchardLikeBundle {          // Orchard and Ironwood share the action shape
  actions: number;
  flags: { spendsEnabled: boolean; outputsEnabled: boolean; crossAddressEnabled: boolean | null; reservedBitsZero: boolean };
  valueBalanceZat: number;                    // positive = value leaves this pool
  anchor: string;
  proofBytes: number;
  canonicalProofBytes: number;                // 2720 + 2272 * actions (ZIP 257)
  nullifiers: string[];
  commitments: string[];                      // cmx
}

export interface DecodedTx {
  txid: string;
  version: number;                            // 4, 5, 6
  versionGroupId: string;                     // "0x26a7270a"
  consensusBranchId: string | null;           // v5+: "0x37a5165b"
  upgrade: string | null;                     // name from zcash_protocol, e.g. "NU6.3"
  lockTime: number;
  expiryHeight: number;
  sizeBytes: number;
  transparent: {
    inputs: { prevTxid: string; prevIndex: number; scriptSigBytes: number; sequence: number; isCoinbase: boolean }[];
    outputs: { valueZat: number; scriptPubKey: string; address: string | null }[];   // address via zcash_address
  };
  sapling: null | { spends: number; outputs: number; valueBalanceZat: number; anchor: string | null; proofBytesEach: number; nullifiers: string[]; commitments: string[] };
  orchard: null | OrchardLikeBundle;
  ironwood: null | OrchardLikeBundle;
  zip317: { logicalActions: number; conventionalFeeZat: number };   // via zcash_primitives fee rule
}

export type CheckStatus = "pass" | "fail" | "warn" | "na";
export interface Check {
  id: string;                                 // stable slug, e.g. "branch-id"
  title: string;
  status: CheckStatus;
  detail: string;                             // plain English with the real numbers from this tx
  zip: { number: number; clause?: string; url: string } | null;
  source?: string;                            // librustzcash / zebra file:line the rule mirrors
}

export interface PcztView {
  roles: { name: "Creator" | "Constructor" | "IO Finalizer" | "Updater" | "Prover" | "Signer" | "Combiner" | "Spend Finalizer" | "Extractor"; done: boolean; evidence: string }[];
  actions: { pool: "sapling" | "orchard" | "ironwood" | "transparent"; index: number; valueZat: number | null; recipient: string | null; userAddress: string | null; proof: boolean; signature: boolean }[];
  checks: Check[];
}

// WASM exports (agent A). Inputs are hex strings; outputs are JSON-serialisable objects; errors throw { code, message }.
export interface LuoraZCore {
  decode_tx(hex: string, network: Network): DecodedTx;
  check_tx(hex: string, network: Network, height: number, transparentInputValuesZat: (number | null)[]): Check[];
  fee_zat(hex: string, transparentInputValuesZat: (number | null)[]): number | null;   // null if any input value unknown
  inspect_pczt(base64OrHex: string, network: Network): PcztView;
  upgrade_at(network: Network, height: number): { name: string; branchId: string; activationHeight: number };
}

// Server routes (agent C). JSON responses.
// GET /api/chain?network=main            → { network, height, branchId, upgrade, endpoint, fetchedAt }
// GET /api/tx/<txid>?network=main        → { txid, hex, height | null, endpoint }   (hex only; decoding happens in the browser)
// GET /api/prevouts/<txid>?network=main  → { values: (number|null)[] }               (transparent input values for the fee)
// GET /api/samples                       → data/samples.json
// GET /api/zebra-errors                  → data/zebra-errors.json
export interface Sample { label: string; network: Network; txid: string; height: number; why: string; pools: string[] }
export interface ZebraErrorEntry {
  variant: string;            // "TransactionError::WrongConsensusBranchId"
  crate: string; file: string; line: number;
  message: string;            // the #[error("...")] text, the string users actually see
  stage: "router" | "block" | "transaction" | "script" | "proof-signature" | "state" | "mempool" | "rpc";
  zips: number[];
  plain: string;              // one-paragraph plain-English explanation + how to fix
  zebraVersion: string;       // tag/commit it was extracted from
}
