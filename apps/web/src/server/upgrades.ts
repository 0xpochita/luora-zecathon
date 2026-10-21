import type { Network } from "../../../../contract/types";
import upgrades from "../../../../data/upgrades.json";

interface UpgradeRow {
  name: string;
  activationHeight: number;
  branchId: string | null;
}

const TABLES: Partial<Record<Network, UpgradeRow[]>> = upgrades.networks;

export function upgradeAtHeight(network: Network, height: number): UpgradeRow | null {
  const rows = TABLES[network];
  if (!rows) return null;
  return rows.filter((row) => row.activationHeight <= height).at(-1) ?? null;
}
