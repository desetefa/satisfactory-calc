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
import {
  getAllProductKeysWithRecipes,
  getExtractorMachineOptionsFull,
  getMachineOptionsForProduct,
} from "./chain";

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

const QUICK_BUILD_MINER_KEYS = ["miner-mk1", "miner-mk2", "miner-mk3"] as const;
const DEFAULT_MINER_KEY = "miner-mk2";

const planTemplateCache = new Map<string, ProductionPlan>();
let planTemplateCachePrimed = false;

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

function makePlanTemplateKey(target: PlannerTarget, options?: PlannerOptions): string {
  const minerKey = options?.minerKey ?? DEFAULT_MINER_KEY;
  return `${target.productKey}|${target.recipeKey}|${minerKey}`;
}

function clonePlanWithFreshIds(plan: ProductionPlan): ProductionPlan {
  const idRemap = new Map<string, string>();
  for (const g of plan.groups) {
    idRemap.set(g.id, nextGroupId());
  }

  const remap = (id: string): string => idRemap.get(id) ?? id;

  return {
    groups: plan.groups.map((g) => ({
      ...g,
      id: remap(g.id),
    })),
    edges: plan.edges.map((e) => ({
      producerGroupId: remap(e.producerGroupId),
      consumerGroupId: remap(e.consumerGroupId),
      itemKey: e.itemKey,
    })),
    rootGroupIds: plan.rootGroupIds.map(remap),
    targetGroupId: remap(plan.targetGroupId),
  };
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

  const recipes = [...getRecipesForProduct(itemKey)].sort((a, b) => {
    const aAlt = isAlternateRecipe(a);
    const bAlt = isAlternateRecipe(b);
    if (aAlt !== bAlt) return aAlt ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  if (recipes.length === 0) {
    visitingProducts.delete(itemKey);
    return { ok: false, error: `No recipe found to produce ${itemKey}` };
  }

  let lastError: string | null = null;
  for (const recipe of recipes) {
    const building = getBuildingForRecipe(recipe);
    if (!building) {
      lastError = `No building for recipe ${recipe.key_name}`;
      continue;
    }

    const { ingredients, products } = recipePerMinute(recipe);
    const productLine = products.find(([k]) => k === itemKey);
    const outputPerMachine = productLine?.[1] ?? 0;
    if (outputPerMachine <= 0) {
      lastError = `Recipe ${recipe.key_name} has no output rate for ${itemKey}`;
      continue;
    }

    const machineCount = Math.max(1, Math.ceil(requiredOutputPerMin / outputPerMachine));
    const groupCheckpoint = groups.length;
    const edgeCheckpoint = edges.length;

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

    let failed = false;
    for (const [ingKey, ingPerMin] of ingredients) {
      const demand = ingPerMin * machineCount;
      const sub = planIngredientOutput(
        ingKey,
        demand,
        options,
        visitingProducts,
        groups,
        edges
      );
      if (!sub.ok) {
        failed = true;
        lastError = sub.error;
        break;
      }
      const producerId = sub.plan.targetGroupId;
      edges.push({ producerGroupId: producerId, consumerGroupId: groupId, itemKey: ingKey });
    }

    if (!failed) {
      visitingProducts.delete(itemKey);
      return { ok: true, plan: { groups, edges, rootGroupIds: [], targetGroupId: groupId } };
    }

    groups.splice(groupCheckpoint);
    edges.splice(edgeCheckpoint);
  }

  visitingProducts.delete(itemKey);
  return { ok: false, error: lastError ?? `No viable recipe path found for ${itemKey}` };
}

/**
 * Build a full machine plan: **one** machine @ 100% on `target.recipeKey`, upstream sized to feed it.
 */
function planProductionFromTargetUncached(
  target: PlannerTarget,
  options?: PlannerOptions
): PlanProductionResult {
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
    plan: consolidatePlan({ groups, edges, rootGroupIds, targetGroupId }),
  };
}

function ensurePlanTemplateCachePrimed() {
  if (planTemplateCachePrimed) return;
  planTemplateCachePrimed = true;

  for (const productKey of getAllProductKeysWithRecipes()) {
    for (const opt of getMachineOptionsForProduct(productKey)) {
      for (const minerKey of QUICK_BUILD_MINER_KEYS) {
        const target: PlannerTarget = { productKey, recipeKey: opt.recipeKey };
        const key = makePlanTemplateKey(target, { minerKey });
        if (planTemplateCache.has(key)) continue;
        idSeq = 0;
        const planned = planProductionFromTargetUncached(target, { minerKey });
        if (planned.ok) {
          planTemplateCache.set(key, planned.plan);
        }
      }
    }
  }
}

/** Warm all quick-build plan templates in memory so first open feels instant. */
export function primeQuickBuildTemplates(): void {
  ensurePlanTemplateCachePrimed();
}

export function planProductionFromTarget(
  target: PlannerTarget,
  options?: PlannerOptions
): PlanProductionResult {
  ensurePlanTemplateCachePrimed();
  idSeq = 0;
  const key = makePlanTemplateKey(target, options);
  const cached = planTemplateCache.get(key);
  if (cached) {
    return { ok: true, plan: clonePlanWithFreshIds(cached) };
  }

  const planned = planProductionFromTargetUncached(target, options);
  if (!planned.ok) return planned;
  planTemplateCache.set(key, planned.plan);
  idSeq = 0;
  return { ok: true, plan: clonePlanWithFreshIds(planned.plan) };
}

/**
 * Post-process a plan: merge all groups that share the same recipeKey into one, summing machine
 * counts and deduplicating supply edges.  Fixes the common case where two downstream recipes both
 * need the same intermediate (e.g. Steel Ingot), causing the planner to emit two separate Foundry
 * groups.
 */
function consolidatePlan(plan: ProductionPlan): ProductionPlan {
  const { groups, edges, rootGroupIds, targetGroupId } = plan;

  // Gather groups by recipeKey; first occurrence is the "primary" (survivor).
  const primaryByRecipe = new Map<string, PlannedMachineGroup>();
  const idRemap = new Map<string, string>(); // secondary id → primary id

  for (const g of groups) {
    const existing = primaryByRecipe.get(g.recipeKey);
    if (existing) {
      // Accumulate count onto primary; mark this id as secondary
      primaryByRecipe.set(g.recipeKey, { ...existing, machineCount: existing.machineCount + g.machineCount });
      idRemap.set(g.id, existing.id);
    } else {
      primaryByRecipe.set(g.recipeKey, g);
    }
  }

  const remapId = (id: string): string => idRemap.get(id) ?? id;

  const mergedGroups = [...primaryByRecipe.values()];

  // Remap edge endpoints and drop self-edges / duplicates.
  const seenEdges = new Set<string>();
  const newEdges: PlannedSupplyEdge[] = [];
  for (const e of edges) {
    const prod = remapId(e.producerGroupId);
    const cons = remapId(e.consumerGroupId);
    if (prod === cons) continue;
    const key = `${prod}→${cons}:${e.itemKey}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      newEdges.push({ producerGroupId: prod, consumerGroupId: cons, itemKey: e.itemKey });
    }
  }

  const newRoots = [...new Set(rootGroupIds.map(remapId))];
  const newTarget = remapId(targetGroupId);

  return { groups: mergedGroups, edges: newEdges, rootGroupIds: newRoots, targetGroupId: newTarget };
}

export function isRecipeSupportedByPlanner(recipeKey: string): boolean {
  if (getExtractorMachineOptionsFull().some((o) => o.recipeKey === recipeKey)) return true;
  const recipe = getRecipe(recipeKey);
  if (!recipe) return false;
  if (!getBuildingForRecipe(recipe)) return false;

  for (const [productKey] of recipe.products) {
    idSeq = 0;
    const planned = planProductionFromTargetUncached(
      { productKey, recipeKey },
      { minerKey: DEFAULT_MINER_KEY }
    );
    if (planned.ok) return true;
  }

  return false;
}
