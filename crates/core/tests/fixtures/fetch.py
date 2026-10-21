import base64
import json
import os
import subprocess
import sys

PROTO_DIR = os.environ.get("LIGHTWALLET_PROTO", "/tmp/luora-z-src/lightwallet-protocol/walletrpc")
ENDPOINTS = {"main": "zec.rocks:443", "test": "testnet.zec.rocks:443"}
SERVICE = "cash.z.wallet.sdk.rpc.CompactTxStreamer"
HERE = os.path.dirname(os.path.abspath(__file__))


def grpc(network, method, body):
    out = subprocess.run(
        ["grpcurl", "-import-path", PROTO_DIR, "-proto", "service.proto", "-d", json.dumps(body),
         ENDPOINTS[network], f"{SERVICE}/{method}"],
        check=True, capture_output=True, text=True,
    ).stdout
    decoder = json.JSONDecoder()
    items, pos = [], 0
    while pos < len(out):
        while pos < len(out) and out[pos].isspace():
            pos += 1
        if pos >= len(out):
            break
        item, pos = decoder.raw_decode(out, pos)
        items.append(item)
    return items


def display_txid(raw_b64):
    return base64.b64decode(raw_b64)[::-1].hex()


def scan(network, start, end):
    blocks = grpc(network, "GetBlockRange", {
        "start": {"height": start}, "end": {"height": end},
        "poolTypes": ["TRANSPARENT", "SAPLING", "ORCHARD", "IRONWOOD"],
    })
    for block in blocks:
        for tx in block.get("vtx", []):
            print(block["height"], tx.get("index", "0"), display_txid(tx["txid"]),
                  "spends", len(tx.get("spends", [])), "outputs", len(tx.get("outputs", [])),
                  "orchard", len(tx.get("actions", [])), "ironwood", len(tx.get("ironwoodActions", [])),
                  "vin", len(tx.get("vin", [])), "vout", len(tx.get("vout", [])))


def save(network, name, label, txid):
    raw = base64.b64encode(bytes.fromhex(txid)[::-1]).decode()
    [result] = grpc(network, "GetTransaction", {"hash": raw})
    fixture = {
        "label": label,
        "network": network,
        "txid": txid,
        "height": int(result["height"]),
        "endpoint": ENDPOINTS[network],
        "method": f"{SERVICE}/GetTransaction",
        "hex": base64.b64decode(result["data"]).hex(),
    }
    with open(os.path.join(HERE, f"{name}.json"), "w") as f:
        json.dump(fixture, f, indent=2)
        f.write("\n")
    print(name, fixture["height"], len(fixture["hex"]) // 2, "bytes")


if __name__ == "__main__":
    command, network, *rest = sys.argv[1:]
    if command == "scan":
        scan(network, int(rest[0]), int(rest[1]))
    elif command == "save":
        save(network, rest[0], rest[1], rest[2])
