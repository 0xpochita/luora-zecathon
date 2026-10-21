import { existsSync } from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { Network } from "../../../../contract/types";
import { ApiError } from "./api-error";
import { indexerEndpoint, type IndexerEndpoint } from "./networks";
import { displayTxidToInternalBytes, internalBytesToDisplayTxid } from "./txid";

export const INDEXER_TIMEOUT_MS = 8_000;
const RETRYABLE_STATUS = new Set([grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED]);
const MEMPOOL_HEIGHT = "0";
const NON_MAIN_CHAIN_HEIGHT = "18446744073709551615";

export interface LightdInfo {
  version: string;
  vendor: string;
  chainName: string;
  consensusBranchId: string;
  blockHeight: string;
  estimatedHeight: string;
  zcashdBuild: string;
  zcashdSubversion: string;
  upgradeName: string;
  upgradeHeight: string;
  lightwalletProtocolVersion: string;
}

export interface BlockId {
  height: string;
  hash: Buffer;
}

export interface CompactAction {
  nullifier: Buffer;
  cmx: Buffer;
}

export interface CompactTx {
  index: string;
  txid: Buffer;
  fee: number;
  spends: unknown[];
  outputs: unknown[];
  actions: CompactAction[];
  ironwoodActions: CompactAction[];
  vin: { prevoutTxid: Buffer; prevoutIndex: number }[];
  vout: { value: string; scriptPubKey: Buffer }[];
}

export interface CompactBlock {
  height: string;
  hash: Buffer;
  time: number;
  vtx: CompactTx[];
}

export interface RawTransaction {
  data: Buffer;
  height: string;
}

export const POOL_TYPES = ["TRANSPARENT", "SAPLING", "ORCHARD", "IRONWOOD"] as const;

type UnaryMethod = (
  request: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: (error: grpc.ServiceError | null, response: unknown) => void,
) => grpc.ClientUnaryCall;

type StreamMethod = (request: unknown, options: grpc.CallOptions) => grpc.ClientReadableStream<unknown>;

type StreamerClient = grpc.Client & Record<string, UnaryMethod & StreamMethod>;

function protoDirectory(): string {
  const candidates = [
    path.join(process.cwd(), "src/server/proto"),
    path.join(process.cwd(), "apps/web/src/server/proto"),
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, "service.proto")));
  if (!found) throw new ApiError("indexer_error", "lightwallet protocol files are missing from the deployment");
  return found;
}

let streamerConstructor: grpc.ServiceClientConstructor | undefined;

function loadStreamer(): grpc.ServiceClientConstructor {
  if (streamerConstructor) return streamerConstructor;
  const directory = protoDirectory();
  const definition = protoLoader.loadSync(path.join(directory, "service.proto"), {
    keepCase: true,
    longs: String,
    enums: String,
    bytes: Buffer,
    defaults: true,
    includeDirs: [directory],
  });
  const loaded = grpc.loadPackageDefinition(definition) as unknown as {
    cash: { z: { wallet: { sdk: { rpc: { CompactTxStreamer: grpc.ServiceClientConstructor } } } } };
  };
  streamerConstructor = loaded.cash.z.wallet.sdk.rpc.CompactTxStreamer;
  return streamerConstructor;
}

const clients = new Map<string, StreamerClient>();

function clientFor(endpoint: IndexerEndpoint): StreamerClient {
  const key = `${endpoint.tls ? "tls" : "plain"}:${endpoint.target}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const Streamer = loadStreamer();
  const credentials = endpoint.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
  const client = new Streamer(endpoint.target, credentials, {
    "grpc.max_receive_message_length": 32 * 1024 * 1024,
    "grpc.keepalive_time_ms": 60_000,
  }) as unknown as StreamerClient;
  clients.set(key, client);
  return client;
}

function toApiError(error: grpc.ServiceError, method: string): ApiError {
  switch (error.code) {
    case grpc.status.NOT_FOUND:
      return new ApiError("not_found", `${method}: the indexer has no record of this item`);
    case grpc.status.DEADLINE_EXCEEDED:
      return new ApiError("indexer_timeout", `${method}: the indexer did not answer within ${INDEXER_TIMEOUT_MS / 1000} s`);
    case grpc.status.UNAVAILABLE:
      return new ApiError("indexer_unavailable", `${method}: the indexer is unreachable`);
    case grpc.status.INVALID_ARGUMENT:
    case grpc.status.OUT_OF_RANGE:
      return new ApiError("bad_request", `${method}: the indexer rejected the request`);
    default:
      return new ApiError("indexer_error", `${method}: the indexer returned ${grpc.status[error.code] ?? error.code}`);
  }
}

function unaryOnce<T>(client: StreamerClient, method: string, request: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](
      request,
      new grpc.Metadata(),
      { deadline: Date.now() + INDEXER_TIMEOUT_MS },
      (error, response) => (error ? reject(error) : resolve(response as T)),
    );
  });
}

async function unary<T>(network: Network, method: string, request: unknown): Promise<T> {
  const client = clientFor(indexerEndpoint(network));
  try {
    return await unaryOnce<T>(client, method, request);
  } catch (firstError) {
    const serviceError = firstError as grpc.ServiceError;
    if (!RETRYABLE_STATUS.has(serviceError.code)) throw toApiError(serviceError, method);
    try {
      return await unaryOnce<T>(client, method, request);
    } catch (secondError) {
      throw toApiError(secondError as grpc.ServiceError, method);
    }
  }
}

export function endpointLabel(network: Network): string {
  return indexerEndpoint(network).label;
}

export function getLightdInfo(network: Network): Promise<LightdInfo> {
  return unary<LightdInfo>(network, "GetLightdInfo", {});
}

export function getLatestBlock(network: Network): Promise<BlockId> {
  return unary<BlockId>(network, "GetLatestBlock", {});
}

export function getBlock(network: Network, height: number): Promise<CompactBlock> {
  return unary<CompactBlock>(network, "GetBlock", { height: String(height) });
}

export async function getTransaction(
  network: Network,
  txid: string,
): Promise<{ raw: Buffer; height: number | null }> {
  const response = await unary<RawTransaction>(network, "GetTransaction", {
    hash: displayTxidToInternalBytes(txid),
  });
  const mined = response.height !== MEMPOOL_HEIGHT && response.height !== NON_MAIN_CHAIN_HEIGHT;
  return { raw: response.data, height: mined ? Number(response.height) : null };
}

export function getBlockRange(
  network: Network,
  startHeight: number,
  endHeight: number,
): Promise<CompactBlock[]> {
  const client = clientFor(indexerEndpoint(network));
  return new Promise((resolve, reject) => {
    const blocks: CompactBlock[] = [];
    const stream = client.GetBlockRange(
      {
        start: { height: String(startHeight) },
        end: { height: String(endHeight) },
        poolTypes: [...POOL_TYPES],
      },
      { deadline: Date.now() + INDEXER_TIMEOUT_MS * 4 },
    );
    stream.on("data", (block) => blocks.push(block as CompactBlock));
    stream.on("error", (error) => reject(toApiError(error as grpc.ServiceError, "GetBlockRange")));
    stream.on("end", () => resolve(blocks));
  });
}

export function compactTxid(tx: CompactTx): string {
  return internalBytesToDisplayTxid(tx.txid);
}
