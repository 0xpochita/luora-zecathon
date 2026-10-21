import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readTransparentBundle } from "../apps/web/src/server/transparent";
import { displayTxidToInternalBytes } from "../apps/web/src/server/txid";
import { SOURCE_ROOT, repoPath } from "./source-checkout";
import {
  FINAL_SEQUENCE,
  type KeyPair,
  newKeyPair,
  type Output,
  signAndSerialize,
  type SpendInput,
  type V5TransparentTx,
} from "./regtest/transparent-tx";

const ZEBRA_IMAGE = "zfnd/zebra:7.0.0-rc.0";
const CONTAINER = "luora-z-zebra-regtest";
const RPC_URL = "http://127.0.0.1:18232";
const NU6_2_BRANCH_ID = 0x5437f330;
const NU6_3_BRANCH_ID = 0x37a5165b;
const MAINNET_TXID_ABSENT_ON_REGTEST = "30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c";
const MATURE_CHAIN_LENGTH = 130;
const GENEROUS_FEE_ZAT = 10_000n;

interface RpcResponse<T> {
  result: T | null;
  error: { code: number; message: string } | null;
}

interface Sample {
  id: string;
  title: string;
  expectedVariant: string;
  how: string;
  zebra: string;
  config: string;
  chainHeight: number;
  request: { method: string; txid: string | null; hex: string };
  response: { code: number; message: string } | null;
  accepted: boolean;
}

interface CoinbaseOutput {
  height: number;
  input: SpendInput;
}

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
}

function rpc<T>(method: string, params: unknown[] = []): RpcResponse<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const output = docker([
    "exec",
    "-i",
    CONTAINER,
    "curl",
    "-s",
    "-H",
    "content-type: application/json",
    "--data-binary",
    "@-",
    RPC_URL,
  ], body);
  return JSON.parse(output) as RpcResponse<T>;
}

function rpcResult<T>(method: string, params: unknown[] = []): T {
  const response = rpc<T>(method, params);
  if (response.error) throw new Error(`${method} failed: ${response.error.code} ${response.error.message}`);
  return response.result as T;
}

function zebraConfig(minerAddress: string, allowUnshieldedCoinbaseSpends: boolean): string {
  return [
    "[network]",
    'network = "Regtest"',
    "",
    "[network.testnet_parameters]",
    `should_allow_unshielded_coinbase_spends = ${allowUnshieldedCoinbaseSpends}`,
    "",
    "[network.testnet_parameters.activation_heights]",
    "Canopy = 1",
    "NU5 = 1",
    '"NU6.3" = 1',
    "",
    "[mining]",
    `miner_address = "${minerAddress}"`,
    "",
    "[state]",
    "ephemeral = true",
    "",
    "[rpc]",
    'listen_addr = "127.0.0.1:18232"',
    "enable_cookie_auth = false",
    "",
  ].join("\n");
}

async function waitForRpc(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if (rpc("getblockcount").result !== null) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("zebrad RPC did not come up");
}

async function startZebra(minerAddress: string, allowUnshieldedCoinbaseSpends: boolean): Promise<string> {
  const configDirectory = path.join(SOURCE_ROOT, "regtest");
  mkdirSync(configDirectory, { recursive: true });
  const config = zebraConfig(minerAddress, allowUnshieldedCoinbaseSpends);
  writeFileSync(path.join(configDirectory, "zebrad.toml"), config);
  stopZebra();
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-v",
    `${configDirectory}:/etc/luora-z:ro`,
    "-e",
    "CONFIG_FILE_PATH=/etc/luora-z/zebrad.toml",
    ZEBRA_IMAGE,
    "zebrad",
    "start",
  ]);
  await waitForRpc();
  return config;
}

function stopZebra(): void {
  try {
    docker(["rm", "-f", CONTAINER]);
  } catch {
    return;
  }
}

function mine(blocks: number): void {
  rpcResult("generate", [blocks]);
}

function tipHeight(): number {
  return rpcResult<number>("getblockcount");
}

function coinbaseOutputAt(height: number, key: KeyPair): CoinbaseOutput {
  const block = rpcResult<{ tx: string[] }>("getblock", [String(height), 1]);
  const txid = block.tx[0];
  const hex = rpcResult<string>("getrawtransaction", [txid, 0]);
  const outputs = readTransparentBundle(Buffer.from(hex, "hex")).outputs;
  const ownScript = Buffer.from(key.scriptPubKey).toString("hex");
  const index = outputs.findIndex((output) => output.scriptPubKey === ownScript);
  if (index < 0) throw new Error(`coinbase at ${height} does not pay the miner address`);
  return {
    height,
    input: {
      outpoint: { txidInternal: displayTxidToInternalBytes(txid), index },
      valueZat: BigInt(outputs[index].valueZat),
      scriptPubKey: key.scriptPubKey,
      sequence: FINAL_SEQUENCE,
    },
  };
}

function payTo(key: KeyPair, input: SpendInput, fee = GENEROUS_FEE_ZAT): Output[] {
  return [{ valueZat: input.valueZat - fee, scriptPubKey: key.scriptPubKey }];
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function main() {
  return run().finally(stopZebra);
}

async function run() {
  const key = newKeyPair();
  const samples: Sample[] = [];
  let config = "";
  let zebraVersion = "";

  const submit = (id: string, title: string, expectedVariant: string, how: string, rawHex: string) => {
    const response = rpc<string>("sendrawtransaction", [rawHex]);
    const sample: Sample = {
      id,
      title,
      expectedVariant,
      how,
      zebra: zebraVersion,
      config,
      chainHeight: tipHeight(),
      request: { method: "sendrawtransaction", txid: response.result ?? null, hex: rawHex },
      response: response.error ?? null,
      accepted: !response.error,
    };
    samples.push(sample);
    console.log(`${id}: ${sample.accepted ? `accepted ${response.result}` : `${response.error?.code} ${response.error?.message}`}`);
    return sample;
  };

  config = await startZebra(key.address, false);
  zebraVersion = `${ZEBRA_IMAGE} (${rpcResult<{ build: string; subversion: string }>("getinfo").subversion})`;
  mine(MATURE_CHAIN_LENGTH);
  const tip = tipHeight();
  const coinbase = coinbaseOutputAt(1, key);
  const unshieldedTx: V5TransparentTx = {
    branchId: NU6_3_BRANCH_ID,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [coinbase.input],
    outputs: payTo(key, coinbase.input),
  };
  submit(
    "unshielded-coinbase-spend",
    "Spending a mature coinbase output to a transparent address",
    "ValidateContextError::UnshieldedTransparentCoinbaseSpend",
    `Regtest with default should_allow_unshielded_coinbase_spends = false. Mined ${tip} blocks to a fresh P2PKH key, then signed a v5 transaction that spends the height-1 coinbase output to a transparent output.`,
    hex(signAndSerialize(unshieldedTx, key)),
  );
  stopZebra();

  config = await startZebra(key.address, true);
  mine(MATURE_CHAIN_LENGTH);
  const height = tipHeight();
  const mature = (offset: number) => coinbaseOutputAt(1 + offset, key).input;

  const baseline = mature(0);
  const baselineTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [baseline], outputs: payTo(key, baseline) };
  const baselineHex = hex(signAndSerialize(baselineTx, key));
  const accepted = submit(
    "baseline-accepted",
    "A correct v5 transparent spend (control case)",
    "accepted",
    "Regtest with should_allow_unshielded_coinbase_spends = true. A v5 transaction with the NU6.3 branch ID spends a mature coinbase output with a correct ZIP 244 signature and a 10,000 zatoshi fee. It is accepted, which shows the signer is right and the failures below come from the one field each changes.",
    baselineHex,
  );
  if (!accepted.accepted) throw new Error("control transaction was rejected; the other samples would be meaningless");

  submit(
    "already-in-mempool",
    "Submitting the same transaction twice",
    "MempoolError::InMempool",
    "The accepted control transaction submitted a second time before it is mined.",
    baselineHex,
  );

  const conflictTx: V5TransparentTx = { ...baselineTx, outputs: payTo(key, baseline, GENEROUS_FEE_ZAT * 2n) };
  submit(
    "mempool-spend-conflict",
    "A second transaction spending the same output while the first waits in the mempool",
    "SameEffectsTipRejectionError::SpendConflict",
    "Same input as the control transaction, different fee, so a different txid that spends an output already spent in the mempool.",
    hex(signAndSerialize(conflictTx, key)),
  );

  const wrongBranch = mature(1);
  const wrongBranchTx: V5TransparentTx = { branchId: NU6_2_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [wrongBranch], outputs: payTo(key, wrongBranch) };
  submit(
    "wrong-branch-id",
    "Signed for NU6.2 after NU6.3 activated",
    "TransactionError::WrongConsensusBranchId",
    "A v5 transaction with nConsensusBranchId 0x5437f330 (NU6.2), signed for that branch, sent to a chain where NU6.3 (0x37a5165b) is active.",
    hex(signAndSerialize(wrongBranchTx, key)),
  );

  const expired = mature(2);
  const expiredTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: height - 10, inputs: [expired], outputs: payTo(key, expired) };
  submit(
    "expired",
    "Expiry height already in the past",
    "TransactionError::ExpiredTransaction",
    `nExpiryHeight set to ${height - 10} while the chain tip is ${height}.`,
    hex(signAndSerialize(expiredTx, key)),
  );

  const unpaid = mature(3);
  const unpaidTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [unpaid], outputs: payTo(key, unpaid, 0n) };
  submit(
    "zero-fee",
    "No fee at all",
    "transaction::unmined::zip317::Error::UnpaidActions",
    "Outputs equal the input value, so the fee is 0 zatoshi and every logical action is unpaid.",
    hex(signAndSerialize(unpaidTx, key)),
  );

  const lowFee = mature(4);
  const lowFeeTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [lowFee], outputs: payTo(key, lowFee, 1_000n) };
  submit(
    "low-fee",
    "Fee of 1,000 zatoshi for 2 logical actions",
    "transaction::unmined::zip317::Error::UnpaidActions",
    "One P2PKH input and one P2PKH output pay 1,000 zatoshi; the conventional fee is marginal_fee times max(2, logical actions).",
    hex(signAndSerialize(lowFeeTx, key)),
  );

  const badSignature = mature(5);
  const badSignatureTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [badSignature], outputs: payTo(key, badSignature) };
  const otherKey = newKeyPair();
  submit(
    "wrong-key-signature",
    "Signed with a key that does not own the output",
    "TransactionError::InternalDowncastError",
    "The input is signed by a different, fresh secp256k1 key, so OP_EQUALVERIFY on the pubkey hash fails.",
    hex(signAndSerialize(badSignatureTx, otherKey)),
  );

  const wrongAmount = mature(6);
  const wrongAmountTx: V5TransparentTx = {
    branchId: NU6_3_BRANCH_ID,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [{ ...wrongAmount, valueZat: wrongAmount.valueZat + 1n }],
    outputs: payTo(key, wrongAmount),
  };
  submit(
    "wrong-prevout-amount",
    "Signature commits to the wrong input amount",
    "TransactionError::InternalDowncastError",
    "The ZIP 244 signature hash is computed with an input value 1 zatoshi higher than the real coinbase output, as a signer with a wrong prevout amount would do.",
    hex(signAndSerialize(wrongAmountTx, key)),
  );

  const locked = mature(7);
  const lockedTx: V5TransparentTx = {
    branchId: NU6_3_BRANCH_ID,
    lockTime: height + 50,
    expiryHeight: 0,
    inputs: [{ ...locked, sequence: FINAL_SEQUENCE - 1 }],
    outputs: payTo(key, locked),
  };
  submit(
    "lock-time-height",
    "nLockTime height in the future",
    "TransactionError::LockedUntilAfterBlockHeight",
    `nLockTime ${height + 50} with a non-final input sequence, while the tip is ${height}.`,
    hex(signAndSerialize(lockedTx, key)),
  );

  const missingTx: V5TransparentTx = {
    branchId: NU6_3_BRANCH_ID,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [
      {
        outpoint: { txidInternal: displayTxidToInternalBytes(MAINNET_TXID_ABSENT_ON_REGTEST), index: 0 },
        valueZat: baseline.valueZat,
        scriptPubKey: key.scriptPubKey,
        sequence: FINAL_SEQUENCE,
      },
    ],
    outputs: payTo(key, baseline),
  };
  submit(
    "missing-input",
    "Spending an output that does not exist on this chain",
    "TransactionError::TransparentInputNotFound",
    `The input points at output 0 of mainnet transaction ${MAINNET_TXID_ABSENT_ON_REGTEST}, which does not exist on this regtest chain.`,
    hex(signAndSerialize(missingTx, key)),
  );

  submit(
    "truncated-hex",
    "Truncated transaction bytes",
    "SerializationError::Io",
    "The control transaction's hex with its last 10 bytes removed.",
    baselineHex.slice(0, -20),
  );

  const immatureHeight = height - 5;
  const immature = coinbaseOutputAt(immatureHeight, key).input;
  const immatureTx: V5TransparentTx = { branchId: NU6_3_BRANCH_ID, lockTime: 0, expiryHeight: 0, inputs: [immature], outputs: payTo(key, immature) };
  submit(
    "immature-coinbase",
    "Spending a coinbase output before 100 confirmations",
    "ValidateContextError::ImmatureTransparentCoinbaseSpend",
    `Spends the coinbase output of block ${immatureHeight} while the tip is ${height}.`,
    hex(signAndSerialize(immatureTx, key)),
  );

  mine(1);
  submit(
    "already-mined",
    "Resubmitting a transaction after it was mined",
    "SameEffectsChainRejectionError::Mined",
    "The control transaction submitted again after one more block mined it.",
    baselineHex,
  );
  submit(
    "double-spend-mined",
    "Spending an output that a mined transaction already spent",
    "TransactionError::TransparentInputNotFound",
    "The conflicting transaction from the mempool-spend-conflict case, submitted after the control transaction was mined.",
    hex(signAndSerialize(conflictTx, key)),
  );

  const output = {
    producedAt: new Date().toISOString(),
    zebra: zebraVersion,
    network: "regtest",
    rpc: "JSON-RPC sendrawtransaction inside the container (docker exec, no published ports)",
    note: "Keys are fresh random secp256k1 keys created for each run and discarded; the chain is ephemeral regtest state.",
    samples,
  };
  writeFileSync(repoPath("data", "zebra-error-samples.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${samples.length} samples`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
