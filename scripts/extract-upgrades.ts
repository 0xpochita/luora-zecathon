import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { librustzcashCheckout, repoPath, zebraCheckout } from "./source-checkout";
import { getLightdInfo, endpointLabel } from "../apps/web/src/server/indexer";

type ZebraNetwork = "main" | "test";

interface UpgradeRow {
  name: string;
  activationHeight: number;
  branchId: string | null;
}

const ZEBRA_DISPLAY_NAMES: Record<string, string> = {
  GENESIS: "Genesis",
  BEFORE_OVERWINTER: "BeforeOverwinter",
  OVERWINTER: "Overwinter",
  SAPLING: "Sapling",
  BLOSSOM: "Blossom",
  HEARTWOOD: "Heartwood",
  CANOPY: "Canopy",
  NU5: "NU5",
  NU6: "NU6",
  NU6_1: "NU6.1",
  NU6_2: "NU6.2",
  NU6_3: "NU6.3",
  NU7: "NU7",
};

const ZEBRA_VARIANT_TO_CONST: Record<string, string> = {
  Overwinter: "OVERWINTER",
  Sapling: "SAPLING",
  Blossom: "BLOSSOM",
  Heartwood: "HEARTWOOD",
  Canopy: "CANOPY",
  Nu5: "NU5",
  Nu6: "NU6",
  Nu6_1: "NU6_1",
  Nu6_2: "NU6_2",
  Nu6_3: "NU6_3",
  Nu7: "NU7",
};

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function zebraActivationHeights(constantsSource: string, network: "mainnet" | "testnet"): Map<string, number> {
  const moduleStart = constantsSource.indexOf(`pub mod ${network} {`);
  if (moduleStart < 0) throw new Error(`activation_heights::${network} not found`);
  const moduleEnd = constantsSource.indexOf("}", moduleStart);
  const body = constantsSource.slice(moduleStart, moduleEnd);
  const heights = new Map<string, number>([["GENESIS", 0]]);
  for (const match of body.matchAll(/pub const (\w+): Height = Height\(([\d_]+)\);/g)) {
    heights.set(match[1], Number(match[2].replaceAll("_", "")));
  }
  return heights;
}

function zebraActivationList(upgradeSource: string, listName: string): string[] {
  const start = upgradeSource.indexOf(`const ${listName}`);
  const end = upgradeSource.indexOf("};", start);
  const body = upgradeSource.slice(start, end);
  return [...body.matchAll(/\((?:block::Height\(0\)|(\w+)),\s*\w+\)/g)].map((match) => match[1] ?? "GENESIS");
}

function zebraBranchIds(upgradeSource: string): Map<string, string> {
  const start = upgradeSource.indexOf("CONSENSUS_BRANCH_IDS");
  const end = upgradeSource.indexOf("];", start);
  const body = upgradeSource.slice(start, end);
  const ids = new Map<string, string>();
  for (const match of body.matchAll(/^\s*\((\w+), ConsensusBranchId\(0x([0-9a-f]+)\)\),/gm)) {
    const constName = ZEBRA_VARIANT_TO_CONST[match[1]];
    if (constName) ids.set(constName, `0x${match[2]}`);
  }
  return ids;
}

function protocolActivationHeights(consensusSource: string, networkStruct: "MainNetwork" | "TestNetwork"): Map<string, number> {
  const start = consensusSource.indexOf(`impl Parameters for ${networkStruct}`);
  if (start < 0) throw new Error(`impl Parameters for ${networkStruct} not found`);
  const end = consensusSource.indexOf("\nimpl ", start + 10);
  const body = consensusSource.slice(start, end);
  const heights = new Map<string, number>();
  for (const match of body.matchAll(/NetworkUpgrade::(\w+) => Some\(BlockHeight\(([\d_]+)\)\)/g)) {
    const constName = ZEBRA_VARIANT_TO_CONST[match[1]];
    if (constName) heights.set(constName, Number(match[2].replaceAll("_", "")));
  }
  return heights;
}

function protocolBranchIds(consensusSource: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const match of consensusSource.matchAll(/BranchId::(\w+) => 0x([0-9a-f_]+),/g)) {
    const constName = ZEBRA_VARIANT_TO_CONST[match[1]];
    if (constName) ids.set(constName, `0x${match[2].replaceAll("_", "")}`);
  }
  return ids;
}

function upgradeAt(rows: UpgradeRow[], height: number): UpgradeRow {
  return rows.filter((row) => row.activationHeight <= height).at(-1)!;
}

async function main() {
  const zebra = zebraCheckout();
  const librustzcash = librustzcashCheckout();
  const constantsFile = "zebra-chain/src/parameters/constants.rs";
  const upgradeFile = "zebra-chain/src/parameters/network_upgrade.rs";
  const consensusFile = "components/zcash_protocol/src/consensus.rs";
  const constantsSource = readFileSync(path.join(zebra.dir, constantsFile), "utf8");
  const upgradeSource = readFileSync(path.join(zebra.dir, upgradeFile), "utf8");
  const consensusSource = readFileSync(path.join(librustzcash.dir, consensusFile), "utf8");

  const branchIds = zebraBranchIds(upgradeSource);
  const protocolIds = protocolBranchIds(consensusSource);
  const mismatches: string[] = [];
  const networks: Record<ZebraNetwork, UpgradeRow[]> = { main: [], test: [] };
  const plan = [
    { network: "main" as const, module: "mainnet" as const, list: "MAINNET_ACTIVATION_HEIGHTS", protocol: "MainNetwork" as const },
    { network: "test" as const, module: "testnet" as const, list: "TESTNET_ACTIVATION_HEIGHTS", protocol: "TestNetwork" as const },
  ];

  for (const step of plan) {
    const heights = zebraActivationHeights(constantsSource, step.module);
    const protocolHeights = protocolActivationHeights(consensusSource, step.protocol);
    for (const constName of zebraActivationList(upgradeSource, step.list)) {
      const activationHeight = heights.get(constName);
      if (activationHeight === undefined) throw new Error(`${step.module}::${constName} has no height`);
      const branchId = branchIds.get(constName) ?? null;
      networks[step.network].push({ name: ZEBRA_DISPLAY_NAMES[constName], activationHeight, branchId });
      const protocolHeight = protocolHeights.get(constName);
      if (protocolHeight !== undefined && protocolHeight !== activationHeight) {
        mismatches.push(`${step.network} ${constName}: zebra ${activationHeight}, zcash_protocol ${protocolHeight}`);
      }
      if (branchId && protocolIds.get(constName) !== branchId) {
        mismatches.push(`${constName} branch id: zebra ${branchId}, zcash_protocol ${protocolIds.get(constName)}`);
      }
    }
    for (const [constName, protocolHeight] of protocolHeights) {
      if (!heights.has(constName)) mismatches.push(`${step.network} ${constName}: only zcash_protocol sets ${protocolHeight}`);
    }
  }

  const live: Record<string, unknown> = {};
  for (const network of ["main", "test"] as const) {
    const info = await getLightdInfo(network);
    const height = Number(info.blockHeight);
    const expected = upgradeAt(networks[network], height);
    const liveBranchId = `0x${info.consensusBranchId.toLowerCase()}`;
    if (expected.branchId !== liveBranchId) {
      mismatches.push(`${network} live branch id ${liveBranchId} at ${height}, table says ${expected.name} ${expected.branchId}`);
    }
    live[network] = {
      endpoint: endpointLabel(network),
      height,
      consensusBranchId: liveBranchId,
      upgrade: expected.name,
      node: info.zcashdSubversion,
      checkedAt: new Date().toISOString(),
    };
  }

  if (mismatches.length > 0) {
    console.error(mismatches.join("\n"));
    process.exit(1);
  }

  const output = {
    source: {
      zebra: {
        repo: "https://github.com/ZcashFoundation/zebra",
        tag: zebra.ref,
        commit: zebra.commit,
        files: [
          `${constantsFile}:${lineOf(constantsSource, constantsSource.indexOf("pub mod activation_heights"))}`,
          `${upgradeFile}:${lineOf(upgradeSource, upgradeSource.indexOf("CONSENSUS_BRANCH_IDS: &"))}`,
        ],
      },
      crossChecked: {
        zcash_protocol: { repo: "https://github.com/zcash/librustzcash", commit: librustzcash.commit, file: consensusFile },
        lightwalletd: live,
      },
    },
    networks,
  };
  writeFileSync(repoPath("data", "upgrades.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote data/upgrades.json from zebra ${zebra.ref} (${zebra.commit.slice(0, 10)})`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
