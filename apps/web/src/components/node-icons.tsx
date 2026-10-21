import { Coins, Cube, Eye, Plant, Rows, Tree, TreeEvergreen } from "@phosphor-icons/react";
import type { NodeId } from "@/lib/anatomy";

export const NODE_ICON: Record<NodeId, typeof Cube> = {
  tx: Cube,
  header: Rows,
  transparent: Eye,
  sapling: Plant,
  orchard: Tree,
  ironwood: TreeEvergreen,
  fee: Coins,
};
