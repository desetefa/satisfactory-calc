/**
 * Production chain calculation for Satisfactory
 * Builds chains from output item back to raw resources, computes machine counts
 */

import type { KeyName } from "./types";
import {
  getRecipesForProduct,
  getRecipesConsuming,
  getBuildingForRecipe,
  recipePerMinute,
  getResource,
  getAllResources,
  getMiner,
  getRecipe,
  getItem,
  getFluid,
  getAllMiners,
  getAllRecipes,
} from "./db";
import {
  getPowerGeneratorInputsPerMinute,
  getPowerGeneratorOptionsForInput,
  POWER_ITEM_KEY,
} from "./powerGenerators";

const RAW_ITEM_KEYS = new Set(
  getAllResources().map((r) => r.key_name)
);

// Fluids from extractors (water, crude-oil) - also "raw"
const EXTRACTOR_FLUIDS = new Set(["water", "crude-oil", "nitrogen-gas"]);

export interface ChainStep {
  /** Output item key at this step */
  itemKey: KeyName;
  /** Recipe key used */
  recipeKey: string;
  /** Building type (miner, smelter, constructor, etc.) */
  buildingKey: string;
  /** Output rate in items/min for ONE machine */
  outputPerMachine: number;
  /** Input rate in items/min for ONE machine (for non-raw steps) */
  inputPerMachine: number;
  /** Number of machines (calculated or user-set) */
  machineCount: number;
  /** Total output rate at this step (outputPerMachine * machineCount) */
  totalOutput: number;
  /** Total input rate needed (for display) */
  totalInput: number;
  /** Is this a raw resource (from miner/extractor)? */
  isRaw: boolean;
}

/** Template for a chain (before computing machine counts) */
export type ChainTemplate = { itemKey: KeyName; recipeKey: string }[];

function isRawResource(key: KeyName): boolean {
  return RAW_ITEM_KEYS.has(key) || EXTRACTOR_FLUIDS.has(key);
}

/** Build a linear chain from output item back to raw. Uses first recipe option per product. */
export function buildChain(
  outputItemKey: KeyName,
  recipeChoices?: Record<string, string> // productKey -> recipeKey
): ChainTemplate | null {
  const steps: { itemKey: KeyName; recipeKey: string }[] = [];
  let current: KeyName = outputItemKey;

  while (true) {
    if (isRawResource(current)) {
      break;
    }

    const recipes = getRecipesForProduct(current);
    if (recipes.length === 0) return null;

    const chosenKey = recipeChoices?.[current] ?? recipes[0].key_name;
    const recipe = recipes.find((r) => r.key_name === chosenKey) ?? recipes[0];

    // Only support single-ingredient recipes for linear chain
    if (recipe.ingredients.length !== 1) return null;

    const [ingredientKey] = recipe.ingredients[0];
    steps.push({ itemKey: current, recipeKey: recipe.key_name });
    current = ingredientKey;
  }

  steps.push({ itemKey: current, recipeKey: "_raw_" });

  // Reverse so raw is first, output last
  steps.reverse();

  return steps.map((s) => ({
    itemKey: s.itemKey,
    recipeKey: s.recipeKey,
  }));
}

function getExtractorRate(buildingKey: string): number {
  const miner = getMiner(buildingKey);
  return miner?.base_rate ?? 60;
}

/** Compute machine counts from a target output rate (items/min) at the final step */
export function computeChainFromOutput(
  chain: { itemKey: KeyName; recipeKey: string }[],
  targetOutputPerMin: number,
  minerKey = "miner-mk1"
): ChainStep[] {
  const result: ChainStep[] = [];
  let requiredOutput = targetOutputPerMin;

  for (let i = chain.length - 1; i >= 0; i--) {
    const { itemKey, recipeKey } = chain[i];

    if (recipeKey === "_raw_") {
      const resource = getResource(itemKey);
      const buildingKey =
        resource?.category === "mineral"
          ? minerKey
          : resource?.category === "oil"
            ? "oil-pump"
            : "water-extractor";
      const outputPerMachine = getExtractorRate(buildingKey);
      const machinesNeeded = Math.ceil(requiredOutput / outputPerMachine);
      const totalOutput = machinesNeeded * outputPerMachine;
      result.unshift({
        itemKey,
        recipeKey,
        buildingKey,
        outputPerMachine,
        inputPerMachine: 0,
        machineCount: machinesNeeded,
        totalOutput,
        totalInput: 0,
        isRaw: true,
      });
      break;
    }

    const recipe = getRecipe(recipeKey) ?? getRecipesForProduct(itemKey)[0];
    if (!recipe) continue;

    const building = getBuildingForRecipe(recipe);
    const { ingredients, products } = recipePerMinute(recipe);

    const productOut = products.find(([k]) => k === itemKey)?.[1] ?? 0;
    const ingredientIn = ingredients[0]?.[1] ?? 0;

    if (productOut <= 0) continue;

    const machinesNeeded = Math.ceil(requiredOutput / productOut);
    const totalOutput = machinesNeeded * productOut;
    const totalInput = machinesNeeded * ingredientIn;

    const buildingKey = building?.key_name ?? "constructor";

    result.unshift({
      itemKey,
      recipeKey,
      buildingKey,
      outputPerMachine: productOut,
      inputPerMachine: ingredientIn,
      machineCount: machinesNeeded,
      totalOutput,
      totalInput,
      isRaw: false,
    });

    requiredOutput = totalInput;
  }

  return result;
}

/** Recompute chain when user edits machine count at a specific step */
export function recomputeChainFromStep(
  steps: ChainStep[],
  editedIndex: number,
  newMachineCount: number
): ChainStep[] {
  const editedStep = steps[editedIndex];
  if (!editedStep) return steps;

  const result = [...steps];
  const newOutput = editedStep.outputPerMachine * newMachineCount;
  const newInput = editedStep.inputPerMachine * newMachineCount;

  result[editedIndex] = {
    ...editedStep,
    machineCount: newMachineCount,
    totalOutput: newOutput,
    totalInput: newInput,
  };

  // Downstream: each step consumes the previous step's output
  let flow = newOutput;
  for (let i = editedIndex + 1; i < result.length; i++) {
    const step = result[i];
    const machines = Math.ceil(flow / step.inputPerMachine);
    const output = machines * step.outputPerMachine;
    result[i] = {
      ...step,
      machineCount: machines,
      totalOutput: output,
      totalInput: flow,
    };
    flow = output;
  }

  // Upstream: each step must supply the next step's input
  flow = newInput;
  for (let i = editedIndex - 1; i >= 0; i--) {
    const step = result[i];
    const machines = Math.ceil(flow / step.outputPerMachine);
    const output = machines * step.outputPerMachine;
    result[i] = {
      ...step,
      machineCount: machines,
      totalOutput: output,
      totalInput: flow,
    };
    flow = step.inputPerMachine * machines;
  }

  return result;
}

/** Extractors that can produce a raw resource */
export function getExtractorOptions(resourceKey: KeyName): { buildingKey: string; name: string; rate: number }[] {
  const resource = getResource(resourceKey);
  if (!resource) return [];

  const result: { buildingKey: string; name: string; rate: number }[] = [];
  const miners = getAllMiners();

  if (resource.category === "mineral") {
    for (const m of miners) {
      if (m.category === "mineral") {
        result.push({ buildingKey: m.key_name, name: m.name, rate: m.base_rate });
      }
    }
  } else if (resource.category === "oil") {
    const oil = miners.find((m) => m.category === "oil");
    if (oil) result.push({ buildingKey: oil.key_name, name: oil.name, rate: oil.base_rate });
  } else if (resource.category === "water") {
    const water = miners.find((m) => m.category === "water");
    if (water) result.push({ buildingKey: water.key_name, name: water.name, rate: water.base_rate });
  }
  return result;
}

/** Sort options so non-alternate recipes appear first (for modals) */
export function sortOptionsNonAltFirst<T extends { recipeName: string }>(opts: T[]): T[] {
  return [...opts].sort((a, b) => {
    const aAlt = a.recipeName.startsWith("Alternate");
    const bAlt = b.recipeName.startsWith("Alternate");
    if (aAlt !== bAlt) return aAlt ? 1 : -1;
    return a.recipeName.localeCompare(b.recipeName, undefined, { sensitivity: "base" });
  });
}

export type MachineOptionFromRecipe = {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
};

/**
 * All ways to produce a given item (normal recipes + extractors). Non-alternate recipes sort first.
 */
export function getMachineOptionsForProduct(productKey: KeyName): MachineOptionFromRecipe[] {
  if (productKey === POWER_ITEM_KEY) return [];
  const byRecipeKey = new Map<string, MachineOptionFromRecipe>();

  for (const recipe of getRecipesForProduct(productKey)) {
    const building = getBuildingForRecipe(recipe);
    if (!building) continue;

    const { ingredients, products } = recipePerMinute(recipe);
    const productLine = products.find(([k]) => k === productKey);
    if (!productLine) continue;
    const [, outputQty] = productLine;
    if (outputQty <= 0) continue;

    const inputPerMachine =
      ingredients.length > 0 ? Math.max(...ingredients.map(([, q]) => q)) : 0;

    byRecipeKey.set(recipe.key_name, {
      recipeKey: recipe.key_name,
      recipeName: recipe.name,
      buildingKey: building.key_name,
      buildingName: building.name,
      outputItemKey: productKey,
      outputPerMachine: outputQty,
      inputPerMachine,
    });
  }

  for (const ext of getExtractorMachineOptionsFull()) {
    if (ext.outputItemKey !== productKey) continue;
    if (!byRecipeKey.has(ext.recipeKey)) {
      byRecipeKey.set(ext.recipeKey, ext);
    }
  }

  return sortOptionsNonAltFirst([...byRecipeKey.values()]);
}

let cachedAllProductKeys: KeyName[] | null = null;

/** Every item/fluid key that can be produced by at least one recipe or extractor (sorted by display name). */
export function getAllProductKeysWithRecipes(): KeyName[] {
  if (cachedAllProductKeys) return cachedAllProductKeys;
  const keys = new Set<KeyName>();
  for (const recipe of getAllRecipes()) {
    for (const [k] of recipe.products) keys.add(k);
  }
  for (const o of getExtractorMachineOptionsFull()) {
    keys.add(o.outputItemKey);
  }
  cachedAllProductKeys = [...keys].sort((a, b) => {
    const na = getItem(a)?.name ?? getFluid(a)?.name ?? a;
    const nb = getItem(b)?.name ?? getFluid(b)?.name ?? b;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
  return cachedAllProductKeys;
}

/** Machine options (recipes + buildings) that consume a given item */
export function getMachineOptionsForInput(
  inputItemKey: KeyName
): {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
}[] {
  const recipes = getRecipesConsuming(inputItemKey);
  const result: {
    recipeKey: string;
    recipeName: string;
    buildingKey: string;
    buildingName: string;
    outputItemKey: KeyName;
    outputPerMachine: number;
    inputPerMachine: number;
  }[] = [];

  for (const recipe of recipes) {
    const building = getBuildingForRecipe(recipe);
    if (!building) continue;

    const { ingredients, products } = recipePerMinute(recipe);
    const inputQty = ingredients.find(([k]) => k === inputItemKey)?.[1] ?? 0;
    if (inputQty <= 0) continue;

    const [outputItemKey, outputQty] = products[0] ?? ["", 0];
    if (!outputItemKey || outputQty <= 0) continue;

    result.push({
      recipeKey: recipe.key_name,
      recipeName: recipe.name,
      buildingKey: building.key_name,
      buildingName: building.name,
      outputItemKey,
      outputPerMachine: outputQty,
      inputPerMachine: inputQty,
    });
  }
  for (const powerOpt of getPowerGeneratorOptionsForInput(inputItemKey)) {
    result.push({
      recipeKey: powerOpt.recipeKey,
      recipeName: powerOpt.recipeName,
      buildingKey: powerOpt.buildingKey,
      buildingName: powerOpt.buildingName,
      outputItemKey: powerOpt.outputItemKey,
      outputPerMachine: powerOpt.outputPerMachine,
      inputPerMachine: powerOpt.inputPerMachine,
    });
  }
  result.sort((a, b) => {
    const aAlt = a.recipeName.startsWith("Alternate");
    const bAlt = b.recipeName.startsWith("Alternate");
    if (aAlt !== bAlt) return aAlt ? 1 : -1;
    return 0;
  });
  return result;
}

/** Extractor options - one per extractor type with default resource (for Add machine modal) */
export function getExtractorMachineOptions(): {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
}[] {
  const opts = getExtractorMachineOptionsFull();
  const seen = new Set<string>();
  return opts.filter((o) => {
    if (seen.has(o.buildingKey)) return false;
    seen.add(o.buildingKey);
    return true;
  });
}

/** All extractor options - resource × extractor pairs (for Produces selector) */
export function getExtractorMachineOptionsFull(): {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
}[] {
  const rawResources = getAllResources().map((r) => r.key_name);
  const result: {
    recipeKey: string;
    recipeName: string;
    buildingKey: string;
    buildingName: string;
    outputItemKey: KeyName;
    outputPerMachine: number;
    inputPerMachine: number;
  }[] = [];
  for (const resourceKey of rawResources) {
    const extractors = getExtractorOptions(resourceKey);
    for (const ext of extractors) {
      const itemName = (getItem(resourceKey) ?? getFluid(resourceKey))?.name ?? resourceKey;
      result.push({
        recipeKey: `_raw_${resourceKey}_${ext.buildingKey}`,
        recipeName: itemName,
        buildingKey: ext.buildingKey,
        buildingName: ext.name,
        outputItemKey: resourceKey,
        outputPerMachine: ext.rate,
        inputPerMachine: 0,
      });
    }
  }
  return result;
}

let cachedAllMachineOptions: ReturnType<typeof getExtractorMachineOptionsFull> | null = null;

/**
 * Every machine option — both raw extractors and recipe-based producers.
 * Used for the first machine in a factory where any machine type is valid
 * (e.g. a processing factory that receives imports instead of extracting raw resources).
 */
export function getAllMachineOptions(): ReturnType<typeof getExtractorMachineOptionsFull> {
  if (cachedAllMachineOptions) return cachedAllMachineOptions;
  const seen = new Set<string>();
  const result = [...getExtractorMachineOptionsFull()];
  for (const key of getAllProductKeysWithRecipes()) {
    for (const opt of getMachineOptionsForProduct(key)) {
      if (!seen.has(opt.recipeKey)) {
        seen.add(opt.recipeKey);
        result.push(opt);
      }
    }
  }
  cachedAllMachineOptions = result;
  return result;
}

/** All recipe inputs per minute (for multi-input machines) */
export function getRecipeInputsPerMinute(recipeKey: string): { itemKey: KeyName; perMinute: number }[] {
  const powerInputs = getPowerGeneratorInputsPerMinute(recipeKey);
  if (powerInputs) return powerInputs;
  const recipe = getRecipe(recipeKey);
  if (!recipe) return [];
  const { ingredients } = recipePerMinute(recipe);
  return ingredients.map(([k, q]) => ({ itemKey: k, perMinute: q }));
}

/** Raw resources (for level 0 selector) */
export function getRawResources(): { key: KeyName; name: string }[] {
  return getAllResources().map((r) => ({
    key: r.key_name,
    name: (getItem(r.key_name) ?? getFluid(r.key_name))?.name ?? r.key_name,
  }));
}

/** Items that have linear (single-input) production chains - good for the calculator */
export function getLinearChainItems(): { key: KeyName; name: string }[] {
  const keys: KeyName[] = [
    "iron-plate",
    "iron-rod",
    "wire",
    "cable",
    "concrete",
    "copper-sheet",
    "copper-ingot",
    "iron-ingot",
    "steel-ingot",
    "steel-beam",
    "steel-pipe",
    "screw",
  ];

  return keys
    .filter((key) => buildChain(key))
    .map((key) => ({
      key,
      name: (getItem(key) ?? getFluid(key))?.name ?? key,
    }));
}
