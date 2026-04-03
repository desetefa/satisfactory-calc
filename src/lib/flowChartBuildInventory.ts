import { getAllNodes } from "@/lib/flowChartFlowRates";
import { getFluid, getItem, getMiner, getRecipesForProduct } from "@/lib/db";
import {
  getMachineClocks,
  powerShardsForClockPercent,
  type TreeNode,
} from "@/lib/flowChartModel";
import { getItemDisplayName } from "@/lib/itemDisplayName";

export type BuildInventoryRow = {
  buildingKey: string;
  buildingName: string;
  itemKey: string;
  itemName: string;
  count: number;
  /** 0..3 power shards needed on each machine in this row. */
  shardsPerMachine: number;
  buildIngredients: { itemName: string; count: number }[] | null;
};

export type BuildInventoryResult = {
  rows: BuildInventoryRow[];
  powerShards: number;
};

function getRowSortComplexity(row: BuildInventoryRow): number {
  // Extractors always first in build order.
  const buildingName = row.buildingName.toLowerCase();
  const isExtractorLike =
    !!getMiner(row.buildingKey) ||
    buildingName.includes("miner") ||
    buildingName.includes("extractor");
  if (isExtractorLike) return -1000;
  const tier = getItem(row.itemKey)?.tier ?? getFluid(row.itemKey)?.tier ?? 99;
  const recipes = getRecipesForProduct(row.itemKey);
  const minIngredientCount = recipes.length > 0 ? Math.min(...recipes.map((r) => r.ingredients.length)) : 0;
  // Tier drives broad progression; ingredient count refines order within the same tier.
  return tier * 100 + minIngredientCount;
}

function compareBuildInventoryRows(a: BuildInventoryRow, b: BuildInventoryRow): number {
  const byComplexity = getRowSortComplexity(a) - getRowSortComplexity(b);
  if (byComplexity !== 0) return byComplexity;
  const byBuilding = a.buildingName.localeCompare(b.buildingName);
  if (byBuilding !== 0) return byBuilding;
  const byItem = a.itemName.localeCompare(b.itemName);
  if (byItem !== 0) return byItem;
  return a.shardsPerMachine - b.shardsPerMachine;
}

const BUILDING_CRAFT_INGREDIENTS: Record<string, { itemName: string; count: number }[]> = {
  "miner-mk1": [
    { itemName: "Portable Miner", count: 1 },
    { itemName: "Iron Plate", count: 10 },
    { itemName: "Concrete", count: 10 },
  ],
  "miner-mk2": [
    { itemName: "Portable Miner", count: 2 },
    { itemName: "Encased Industrial Beam", count: 10 },
    { itemName: "Steel Pipe", count: 20 },
    { itemName: "Modular Frame", count: 10 },
  ],
  "miner-mk3": [
    { itemName: "Portable Miner", count: 3 },
    { itemName: "Steel Pipe", count: 50 },
    { itemName: "Supercomputer", count: 5 },
    { itemName: "Fused Modular Frame", count: 10 },
    { itemName: "Turbo Motor", count: 3 },
  ],
  "oil-extractor": [
    { itemName: "Motor", count: 15 },
    { itemName: "Encased Industrial Beam", count: 20 },
    { itemName: "Cable", count: 60 },
  ],
  "water-extractor": [
    { itemName: "Copper Sheet", count: 20 },
    { itemName: "Reinforced Iron Plate", count: 10 },
    { itemName: "Rotor", count: 10 },
  ],
  smelter: [
    { itemName: "Iron Rod", count: 5 },
    { itemName: "Wire", count: 8 },
  ],
  foundry: [
    { itemName: "Modular Frame", count: 10 },
    { itemName: "Rotor", count: 10 },
    { itemName: "Concrete", count: 20 },
  ],
  constructor: [
    { itemName: "Reinforced Iron Plate", count: 2 },
    { itemName: "Cable", count: 8 },
  ],
  assembler: [
    { itemName: "Reinforced Iron Plate", count: 8 },
    { itemName: "Rotor", count: 4 },
    { itemName: "Cable", count: 10 },
  ],
  manufacturer: [
    { itemName: "Motor", count: 10 },
    { itemName: "Modular Frame", count: 20 },
    { itemName: "Plastic", count: 50 },
    { itemName: "Cable", count: 50 },
  ],
  "oil-refinery": [
    { itemName: "Motor", count: 10 },
    { itemName: "Encased Industrial Beam", count: 10 },
    { itemName: "Steel Pipe", count: 30 },
    { itemName: "Copper Sheet", count: 20 },
  ],
  packager: [
    { itemName: "Steel Beam", count: 20 },
    { itemName: "Rubber", count: 10 },
    { itemName: "Plastic", count: 10 },
  ],
  blender: [
    { itemName: "Computer", count: 10 },
    { itemName: "Heavy Modular Frame", count: 10 },
    { itemName: "Motor", count: 20 },
    { itemName: "Aluminum Casing", count: 50 },
  ],
  accelerator: [
    { itemName: "Turbo Motor", count: 10 },
    { itemName: "Supercomputer", count: 10 },
    { itemName: "Fused Modular Frame", count: 25 },
    { itemName: "Cooling System", count: 50 },
    { itemName: "Quickwire", count: 500 },
  ],
  converter: [
    { itemName: "Fused Modular Frame", count: 10 },
    { itemName: "Cooling System", count: 25 },
    { itemName: "Radio Control Unit", count: 50 },
    { itemName: "SAM Fluctuator", count: 100 },
  ],
  "quantum-encoder": [
    { itemName: "Turbo Motor", count: 20 },
    { itemName: "Supercomputer", count: 20 },
    { itemName: "Cooling System", count: 50 },
    { itemName: "Time Crystal", count: 50 },
    { itemName: "Ficsite Trigon", count: 100 },
  ],
  "coal-generator": [
    { itemName: "Reinforced Iron Plate", count: 20 },
    { itemName: "Rotor", count: 10 },
    { itemName: "Cable", count: 30 },
  ],
  "fuel-generator": [
    { itemName: "Motor", count: 15 },
    { itemName: "Encased Industrial Beam", count: 15 },
    { itemName: "Copper Sheet", count: 30 },
    { itemName: "Rubber", count: 50 },
    { itemName: "Quickwire", count: 50 },
  ],
};

function getBuildingCraftIngredients(buildingKey: string): { itemName: string; count: number }[] | null {
  return BUILDING_CRAFT_INGREDIENTS[buildingKey] ?? null;
}

/** Machines and power shards needed for the current flow. */
export function computeBuildInventory(tree: TreeNode): BuildInventoryResult | null {
  if (!tree.node.outputItemKey) return null;

  const rowMap = new Map<string, BuildInventoryRow>();
  let powerShards = 0;
  for (const t of getAllNodes(tree)) {
    const { buildingKey, buildingName, outputItemKey } = t.node;
    if (!buildingKey || !outputItemKey) continue;
    const itemName = getItemDisplayName(outputItemKey, "comfortable");
    for (const clock of getMachineClocks(t.node)) {
      const shardsPerMachine = powerShardsForClockPercent(clock);
      const key = `${buildingKey}::${outputItemKey}::${shardsPerMachine}`;
      const prev = rowMap.get(key);
      if (prev) prev.count += 1;
      else rowMap.set(key, {
        buildingKey,
        buildingName,
        itemKey: outputItemKey,
        itemName,
        count: 1,
        shardsPerMachine,
        buildIngredients: getBuildingCraftIngredients(buildingKey),
      });
      powerShards += shardsPerMachine;
    }
  }

  const rows = [...rowMap.values()].sort(compareBuildInventoryRows);

  return { rows, powerShards };
}

/** Aggregate inventory across multiple factory trees (project-level build sheet). */
export function computeBuildInventoryForTrees(trees: TreeNode[]): BuildInventoryResult | null {
  const merged = new Map<string, BuildInventoryRow>();
  let powerShards = 0;
  for (const tree of trees) {
    const inv = computeBuildInventory(tree);
    if (!inv) continue;
    powerShards += inv.powerShards;
    for (const row of inv.rows) {
      const key = `${row.buildingKey}::${row.itemKey}::${row.shardsPerMachine}`;
      const prev = merged.get(key);
      if (prev) prev.count += row.count;
      else merged.set(key, { ...row });
    }
  }
  if (merged.size === 0) return null;
  const rows = [...merged.values()].sort(compareBuildInventoryRows);
  return { rows, powerShards };
}
