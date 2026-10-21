export type Network = "main" | "test" | "regtest";

export interface OrchardLikeBundle {
  actions: number;
  flags: { spendsEnabled: boolean; outputsEnabled: boolean; crossAddressEnabled: boolean | null; reservedBitsZero: boolean };
  valueBalanceZat: number;
  anchor: string;
  proofBytes: number;
  canonicalProofBytes: number;
  nullifiers: string[];
  commitments: string[];
}

export interface DecodedTx {
  txid: string;
  version: number;
  versionGroupId: string;
  consensusBranchId: string | null;
  upgrade: string | null;
  lockTime: number;
  expiryHeight: number;
  sizeBytes: number;
  transparent: {
    inputs: { prevTxid: string; prevIndex: number; scriptSigBytes: number; sequence: number; isCoinbase: boolean }[];
    outputs: { valueZat: number; scriptPubKey: string; address: string | null }[];
  };
  sapling: null | { spends: number; outputs: number; valueBalanceZat: number; anchor: string | null; proofBytesEach: number; nullifiers: string[]; commitments: string[] };
  orchard: null | OrchardLikeBundle;
  ironwood: null | OrchardLikeBundle;
  zip317: { logicalActions: number; conventionalFeeZat: number };
}

export type CheckStatus = "pass" | "fail" | "warn" | "na";
export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  zip: { number: number; clause?: string; url: string } | null;
  source?: string;
}

export interface PcztView {
  roles: { name: "Creator" | "Constructor" | "IO Finalizer" | "Updater" | "Prover" | "Signer" | "Combiner" | "Spend Finalizer" | "Extractor"; done: boolean; evidence: string }[];
  actions: { pool: "sapling" | "orchard" | "ironwood" | "transparent"; index: number; valueZat: number | null; recipient: string | null; userAddress: string | null; proof: boolean; signature: boolean }[];
  checks: Check[];
}

export type TraceKind =
  | "TX"
  | "HEADER"
  | "TRANSPARENT"
  | "VIN"
  | "VOUT"
  | "SAPLING"
  | "SPEND"
  | "OUTPUT"
  | "BALANCE"
  | "PROOF"
  | "AUTH SIG"
  | "BINDING SIG"
  | "JOINSPLITS"
  | "ORCHARD"
  | "IRONWOOD"
  | "ACTION";

export interface TraceField {
  name: string;
  value: string;
  display: string;
  encrypted?: boolean;
}

export interface TraceNode {
  id: string;
  parentId: string | null;
  depth: number;
  kind: TraceKind;
  label: string;
  offset: number;
  length: number;
  fields: TraceField[];
}

export interface LuoraZCore {
  decode_tx(hex: string, network: Network): DecodedTx;
  check_tx(hex: string, network: Network, height: number, transparentInputValuesZat: (number | null)[]): Check[];
  fee_zat(hex: string, transparentInputValuesZat: (number | null)[]): number | null;
  inspect_pczt(base64OrHex: string, network: Network): PcztView;
  upgrade_at(network: Network, height: number): { name: string; branchId: string; activationHeight: number };
  trace_tx(hex: string, network: Network): TraceNode[];
}

export interface Sample { label: string; network: Network; txid: string; height: number; why: string; pools: string[] }
export interface ZebraErrorEntry {
  variant: string;
  crate: string; file: string; line: number;
  message: string;
  stage: "router" | "block" | "transaction" | "script" | "proof-signature" | "state" | "mempool" | "rpc";
  zips: number[];
  plain: string;
  zebraVersion: string;
}
