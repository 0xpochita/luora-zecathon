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


def fetch_hex(network, txid):
    raw = base64.b64encode(bytes.fromhex(txid)[::-1]).decode()
    [result] = grpc(network, "GetTransaction", {"hash": raw})
    return base64.b64decode(result["data"]).hex()


def decode_with_cli(network, tx_hex):
    cli = os.path.join(HERE, "..", "..", "target", "debug", "luora-z")
    out = subprocess.run([cli, "decode", "--network", network, tx_hex], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def prevouts(name):
    path = os.path.join(HERE, f"{name}.json")
    fixture = json.load(open(path))
    decoded = decode_with_cli(fixture["network"], fixture["hex"])
    values = []
    for tx_in in decoded["transparent"]["inputs"]:
        if tx_in["isCoinbase"]:
            values.append(None)
            continue
        prev = decode_with_cli(fixture["network"], fetch_hex(fixture["network"], tx_in["prevTxid"]))
        values.append(prev["transparent"]["outputs"][tx_in["prevIndex"]]["valueZat"])
    fixture["transparentInputValuesZat"] = values
    with open(path, "w") as f:
        json.dump(fixture, f, indent=2)
        f.write("\n")
    print(name, values)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "scan":
        scan(args[0], int(args[1]), int(args[2]))
    elif command == "save":
        save(*args)
    elif command == "prevouts":
        prevouts(args[0])
