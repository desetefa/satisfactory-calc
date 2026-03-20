/**
 * Multi-input production planner: one machine @ 100% on the target recipe, recursive upstream.
 *
 * **Subtree dedupe / merge** (same item+recipe subgraph shared by multiple consumers) is deferred — see plan phase 2b.
 */

import type { KeyName, Recipe } from "./types";
import {
  getRecipe,
  getRecipesForProduct,
  getResource,
  getMiner,
  recipePerMinute,
  getBuildingForRecipe,
} from "./db";
import { getExtractorMachineOptionsFull } from "./chain";

const EXTRACTOR_FLUIDS = new Set<KeyName>(["water", "crude-oil", "nitrogen-gas"]);

export function isRawResourceKey(key: KeyName): boolean {
  return Boolean(getResource(key)) || EXTRACTOR_FLUIDS.has(key);
}

export type PlannerTarget = {
  productKey: KeyName;
  recipeKey: string;
};

export type PlannedMachineGroup = {
  id: string;
  recipeKey: string;
  buildingKey: string;
  outputItemKey: KeyName;
  /** Output items/min per machine @ 100% */
  outputPerMachine: number;
  machineCount: number;
  clockPercent: number;
};

export type PlannedSupplyEdge = {
  producerGroupId: string;
  consumerGroupId: string;
  itemKey: KeyName;
};

export type ProductionPlan = {
  groups: PlannedMachineGroup[];
  edges: PlannedSupplyEdge[];
  rootGroupIds: string[];
  targetGroupId: string;
};

export type PlannerOptions = {
  minerKey?: string;
};

export type PlanProductionResult =
  | { ok: true; plan: ProductionPlan }
  | { ok: false; error: string };

function isAlternateRecipe(recipe: Recipe): boolean {
  return recipe.name.startsWith("Alternate");
}

/** First non-alternate recipe for product, else first recipe */
export function pickDefaultRecipeForProduct(productKey: KeyName): Recipe | null {
  const recipes = getRecipesForProduct(productKey);
  if (recipes.length === 0) return null;
  const sorted = [...recipes].sort((a, b) => {
    const aAlt = isAlternateRecipe(a);
    const bAlt = isAlternateRecipe(b);
    if (aAlt !== bAlt) return aAlt ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return sorted[0] ?? null;
}

function getExtractorRate(buildingKey: string): number {
  return getMiner(buildingKey)?.base_rate ?? 60;
}

function rawBuildingKey(resourceKey: KeyName, minerKey: string): string {
  const resource = getResource(resourceKey);
  if (!resource) {
    if (resourceKey === "water") return "water-extractor";
    if (resourceKey === "crude-oil") return "oil-pump";
    return "water-extractor";
  }
  if (resource.category === "mineral") return minerKey;
  if (resource.category === "oil") return "oil-pump";
  return "water-extractor";
}

let idSeq = 0;
function nextGroupId(): string {
  idSeq += 1;
  return `planner-g-${idSeq}`;
}

/**
 * Plan upstream for `itemKey` at required **output** rate (items/min from this producer).
 */
function planIngredientOutput(
  itemKey: KeyName,
  requiredOutputPerMin: number,
  options: PlannerOptions,
  visitingProducts: Set<KeyName>,
  groups: PlannedMachineGroup[],
  edges: PlannedSupplyEdge[]
): PlanProductionResult {
  if (requiredOutputPerMin <= 0) {
    return { ok: false, error: `Invalid demand for ${itemKey}: ${requiredOutputPerMin}` };
  }

  if (isRawResourceKey(itemKey)) {
    const minerKey = options.minerKey ?? "miner-mk2";
    const buildingKey = rawBuildingKey(itemKey, minerKey);
    const outputPerMachine = getExtractorRate(buildingKey);
    const machineCount = Math.max(1, Math.ceil(requiredOutputPerMin / outputPerMachine));
    const id = nextGroupId();
    groups.push({
      id,
      recipeKey: `_raw_${itemKey}_${buildingKey}`,
      buildingKey,
      outputItemKey: itemKey,
      outputPerMachine,
      machineCount,
      clockPercent: 100,
    });
    return { ok: true, plan: { groups, edges, rootGroupIds: [], targetGroupId: id } };
  }

  if (visitingProducts.has(itemKey)) {
    return { ok: false, error: `Cyclic dependency while planning ${itemKey}` };
  }
  visitingProducts.add(itemKey);

  const recipe = pickDefaultRecipeForProduct(itemKey);
  if (!recipe) {
    visitingProducts.delete(itemKey);
    return { ok: false, error: `No recipe found to produce ${itemKey}` };
  }

  const building = getBuildingForRecipe(recipe);
  if (!building) {
    visitingProducts.delete(itemKey);
    return { ok: false, error: `No building for recipe ${recipe.key_name}` };
  }

  const { ingredients, products } = recipePerMinute(recipe);
  const productLine = products.find(([k]) => k === itemKey);
  const outputPerMachine = productLine?.[1] ?? 0;
  if (outputPerMachine <= 0) {
    visitingProducts.delete(itemKey);
    return { ok: false, error: `Recipe ${recipe.key_name} has no output rate for ${itemKey}` };
  }

  const machineCount = Math.max(1, Math.ceil(requiredOutputPerMin / outputPerMachine));

  const groupId = nextGroupId();
  groups.push({
    id: groupId,
    recipeKey: recipe.key_name,
    buildingKey: building.key_name,
    outputItemKey: itemKey,
    outputPerMachine,
    machineCount,
    clockPercent: 100,
  });

  for (const [ingKey, ingPerMin] of ingredients) {
    const demand = ingPerMin * machineCount;
    const sub = planIngredientOutput(
      ingKey,
      demand,
      options,
      new Set(visitingProducts),
      groups,
      edges
    );
    if (!sub.ok) {
      visitingProducts.delete(itemKey);
      return sub;
    }
    const producerId = sub.plan.targetGroupId;
    edges.push({ producerGroupId: producerId, consumerGroupId: groupId, itemKey: ingKey });
  }

  visitingProducts.delete(itemKey);
  return { ok: true, plan: { groups, edges, rootGroupIds: [], targetGroupId: groupId } };
}

/**
 * Build a full machine plan: **one** machine @ 100% on `target.recipeKey`, upstream sized to feed it.
 */
export function planProductionFromTarget(
  target: PlannerTarget,
  options?: PlannerOptions
): PlanProductionResult {
  idSeq = 0;
  const groups: PlannedMachineGroup[] = [];
  const edges: PlannedSupplyEdge[] = [];

  /** Standalone extractor row (not in recipes table) */
  const extractorOpt = getExtractorMachineOptionsFull().find(
    (o) => o.recipeKey === target.recipeKey && o.outputItemKey === target.productKey
  );
  if (extractorOpt) {
    const id = nextGroupId();
    groups.push({
      id,
      recipeKey: extractorOpt.recipeKey,
      buildingKey: extractorOpt.buildingKey,
      outputItemKey: target.productKey,
      outputPerMachine: extractorOpt.outputPerMachine,
      machineCount: 1,
      clockPercent: 100,
    });
    return {
      ok: true,
      plan: { groups, edges, rootGroupIds: [id], targetGroupId: id },
    };
  }

  const recipe = getRecipe(target.recipeKey);
  if (!recipe) {
    return { ok: false, error: `Unknown recipe: ${target.recipeKey}` };
  }
  if (!recipe.products.some(([k]) => k === target.productKey)) {
    return { ok: false, error: `Recipe does not produce ${target.productKey}` };
  }

  const building = getBuildingForRecipe(recipe);
  if (!building) {
    return { ok: false, error: `No building for recipe ${target.recipeKey}` };
  }

  const { ingredients, products } = recipePerMinute(recipe);
  const productLine = products.find(([k]) => k === target.productKey);
  const outputPerMachine = productLine?.[1] ?? 0;
  if (outputPerMachine <= 0) {
    return { ok: false, error: "Target recipe has no output rate for selected product" };
  }

  const machineCount = 1;

  const targetGroupId = nextGroupId();
  groups.push({
    id: targetGroupId,
    recipeKey: recipe.key_name,
    buildingKey: building.key_name,
    outputItemKey: target.productKey,
    outputPerMachine,
    machineCount,
    clockPercent: 100,
  });

  const visiting = new Set<KeyName>();

  for (const [ingKey, ingPerMin] of ingredients) {
    const demand = ingPerMin * machineCount;
    const sub = planIngredientOutput(ingKey, demand, options ?? {}, visiting, groups, edges);
    if (!sub.ok) return sub;
    edges.push({
      producerGroupId: sub.plan.targetGroupId,
      consumerGroupId: targetGroupId,
      itemKey: ingKey,
    });
  }

  const consumers = new Set(edges.map((e) => e.consumerGroupId));
  const rootGroupIds = groups.filter((g) => !consumers.has(g.id)).map((g) => g.id);

  return {
    ok: true,
    plan: { groups, edges, rootGroupIds, targetGroupId },
  };
}

export function isRecipeSupportedByPlanner(recipeKey: string): boolean {
  if (getExtractorMachineOptionsFull().some((o) => o.recipeKey === recipeKey)) return true;
  const recipe = getRecipe(recipeKey);
  if (!recipe) return false;
  return Boolean(getBuildingForRecipe(recipe));
}
