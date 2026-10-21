import { internalBytesToDisplayTxid } from "./txid";

export interface TransparentInputRef {
  prevTxid: string;
  prevIndex: number;
  isCoinbase: boolean;
}

export interface TransparentOutputValue {
  valueZat: number;
  scriptPubKey: string;
}

export interface TransparentBundle {
  version: number;
  inputs: TransparentInputRef[];
  outputs: TransparentOutputValue[];
}

const OVERWINTER_FLAG = 0x80000000;
const NULL_PREVOUT_INDEX = 0xffffffff;
const MAX_ZATOSHI = 21_000_000 * 100_000_000;

class ByteCursor {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  take(length: number): Buffer {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`transaction ends early: wanted ${length} bytes at offset ${this.offset}`);
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  u32(): number {
    return this.take(4).readUInt32LE(0);
  }

  i64(): bigint {
    return this.take(8).readBigInt64LE(0);
  }

  compactSize(): number {
    const first = this.take(1)[0];
    if (first < 0xfd) return first;
    if (first === 0xfd) return this.take(2).readUInt16LE(0);
    if (first === 0xfe) return this.u32();
    const value = this.take(8).readBigUInt64LE(0);
    if (value > BigInt(this.bytes.length)) throw new Error("compactSize larger than the transaction");
    return Number(value);
  }
}

export function readTransparentBundle(raw: Uint8Array): TransparentBundle {
  const cursor = new ByteCursor(Buffer.from(raw));
  const header = cursor.u32();
  const overwintered = (header & OVERWINTER_FLAG) !== 0;
  const version = header & 0x7fffffff;

  if (overwintered) {
    cursor.u32();
    if (version >= 5) {
      cursor.u32();
      cursor.u32();
      cursor.u32();
    }
  } else if (version > 2) {
    throw new Error(`version ${version} transaction without the overwintered flag`);
  }

  const inputCount = cursor.compactSize();
  const inputs: TransparentInputRef[] = [];
  for (let index = 0; index < inputCount; index += 1) {
    const prevHash = cursor.take(32);
    const prevIndex = cursor.u32();
    cursor.take(cursor.compactSize());
    cursor.u32();
    const isCoinbase = prevIndex === NULL_PREVOUT_INDEX && prevHash.every((byte) => byte === 0);
    inputs.push({ prevTxid: internalBytesToDisplayTxid(prevHash), prevIndex, isCoinbase });
  }

  const outputCount = cursor.compactSize();
  const outputs: TransparentOutputValue[] = [];
  for (let index = 0; index < outputCount; index += 1) {
    const value = cursor.i64();
    if (value < 0n || value > BigInt(MAX_ZATOSHI)) throw new Error(`output ${index} value out of range`);
    const scriptPubKey = cursor.take(cursor.compactSize()).toString("hex");
    outputs.push({ valueZat: Number(value), scriptPubKey });
  }

  return { version, inputs, outputs };
}
