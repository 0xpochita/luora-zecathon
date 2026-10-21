import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const V5_VERSION_GROUP_ID = 0x26a7270a;
export const SIGHASH_ALL = 0x01;
export const FINAL_SEQUENCE = 0xffffffff;
const TESTNET_P2PKH_PREFIX = Uint8Array.of(0x1d, 0x25);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface Outpoint {
  txidInternal: Uint8Array;
  index: number;
}

export interface SpendInput {
  outpoint: Outpoint;
  valueZat: bigint;
  scriptPubKey: Uint8Array;
  sequence: number;
}

export interface Output {
  valueZat: bigint;
  scriptPubKey: Uint8Array;
}

export interface V5TransparentTx {
  branchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: SpendInput[];
  outputs: Output[];
}

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  pubkeyHash: Uint8Array;
  scriptPubKey: Uint8Array;
  address: string;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

function u32le(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function i64le(value: bigint): Uint8Array {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}

export function compactSize(length: number): Uint8Array {
  if (length < 0xfd) return Uint8Array.of(length);
  if (length <= 0xffff) return concat(Uint8Array.of(0xfd), Uint8Array.from(Buffer.from([length & 0xff, length >> 8])));
  return concat(Uint8Array.of(0xfe), u32le(length));
}

function withLength(bytes: Uint8Array): Uint8Array {
  return concat(compactSize(bytes.length), bytes);
}

function personalHash(personalization: string, data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization: Buffer.from(personalization, "latin1") });
}

function base58check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  const bytes = concat(payload, checksum);
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (number > 0n) {
    encoded = BASE58_ALPHABET[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

export function p2pkhScript(pubkeyHash: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x76, 0xa9, 0x14), pubkeyHash, Uint8Array.of(0x88, 0xac));
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  const publicKey = secp256k1.getPublicKey(secretKey, true);
  const pubkeyHash = ripemd160(sha256(publicKey));
  return {
    secretKey,
    publicKey,
    pubkeyHash,
    scriptPubKey: p2pkhScript(pubkeyHash),
    address: base58check(concat(TESTNET_P2PKH_PREFIX, pubkeyHash)),
  };
}

export function newKeyPair(): KeyPair {
  return keyPairFromSecret(secp256k1.utils.randomSecretKey());
}

function encodeOutpoint(outpoint: Outpoint): Uint8Array {
  return concat(outpoint.txidInternal, u32le(outpoint.index));
}

function encodeOutput(output: Output): Uint8Array {
  return concat(i64le(output.valueZat), withLength(output.scriptPubKey));
}

function headerDigest(tx: V5TransparentTx): Uint8Array {
  return personalHash(
    "ZTxIdHeadersHash",
    concat(u32le(0x80000005), u32le(V5_VERSION_GROUP_ID), u32le(tx.branchId), u32le(tx.lockTime), u32le(tx.expiryHeight)),
  );
}

function transparentSignatureDigest(tx: V5TransparentTx, inputIndex: number): Uint8Array {
  const input = tx.inputs[inputIndex];
  const prevouts = personalHash("ZTxIdPrevoutHash", concat(...tx.inputs.map((each) => encodeOutpoint(each.outpoint))));
  const amounts = personalHash("ZTxTrAmountsHash", concat(...tx.inputs.map((each) => i64le(each.valueZat))));
  const scripts = personalHash("ZTxTrScriptsHash", concat(...tx.inputs.map((each) => withLength(each.scriptPubKey))));
  const sequences = personalHash("ZTxIdSequencHash", concat(...tx.inputs.map((each) => u32le(each.sequence))));
  const outputs = personalHash("ZTxIdOutputsHash", concat(...tx.outputs.map(encodeOutput)));
  const txin = personalHash(
    "Zcash___TxInHash",
    concat(encodeOutpoint(input.outpoint), i64le(input.valueZat), withLength(input.scriptPubKey), u32le(input.sequence)),
  );
  return personalHash(
    "ZTxIdTranspaHash",
    concat(Uint8Array.of(SIGHASH_ALL), prevouts, amounts, scripts, sequences, outputs, txin),
  );
}

export function signatureHash(tx: V5TransparentTx, inputIndex: number): Uint8Array {
  const personalization = concat(Buffer.from("ZcashTxHash_", "latin1"), u32le(tx.branchId));
  const emptySapling = personalHash("ZTxIdSaplingHash", new Uint8Array());
  const emptyOrchard = personalHash("ZTxIdOrchardHash", new Uint8Array());
  return blake2b(concat(headerDigest(tx), transparentSignatureDigest(tx, inputIndex), emptySapling, emptyOrchard), {
    dkLen: 32,
    personalization,
  });
}

export function p2pkhScriptSig(tx: V5TransparentTx, inputIndex: number, key: KeyPair): Uint8Array {
  const sighash = signatureHash(tx, inputIndex);
  const der = secp256k1.sign(sighash, key.secretKey, { prehash: false, format: "der" });
  const signature = concat(der, Uint8Array.of(SIGHASH_ALL));
  return concat(withLength(signature), withLength(key.publicKey));
}

export function serializeV5(tx: V5TransparentTx, scriptSigs: Uint8Array[]): Uint8Array {
  const inputs = tx.inputs.map((input, index) =>
    concat(encodeOutpoint(input.outpoint), withLength(scriptSigs[index]), u32le(input.sequence)),
  );
  return concat(
    u32le(0x80000005),
    u32le(V5_VERSION_GROUP_ID),
    u32le(tx.branchId),
    u32le(tx.lockTime),
    u32le(tx.expiryHeight),
    compactSize(tx.inputs.length),
    ...inputs,
    compactSize(tx.outputs.length),
    ...tx.outputs.map(encodeOutput),
    compactSize(0),
    compactSize(0),
    compactSize(0),
  );
}

export function signAndSerialize(tx: V5TransparentTx, key: KeyPair): Uint8Array {
  return serializeV5(
    tx,
    tx.inputs.map((_, index) => p2pkhScriptSig(tx, index, key)),
  );
}
