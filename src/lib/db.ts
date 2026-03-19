/**
 * Satisfactory game data access layer
 * Static data bundled with the app - no external DB needed for Vercel
 * Data version: Satisfactory 1.0 (from KirkMcDonald, Oct 2024)
 */

import type {
  SatisfactoryData,
  Belt,
  Pipe,
  Building,
  Miner,
  Item,
  Fluid,
  Recipe,
  Resource,
  KeyName,
} from "./types";

import data from "@/data/satisfactory.json";

const db = data as SatisfactoryData;

// ---------------------------------------------------------------------------
// Lookup by key_name (primary access pattern)
// ---------------------------------------------------------------------------

const beltByKey = new Map(db.belts.map((b) => [b.key_name, b]));
const pipeByKey = new Map(db.pipes.map((p) => [p.key_name, p]));
const buildingByKey = new Map(db.buildings.map((b) => [b.key_name, b]));
const minerByKey = new Map(db.miners.map((m) => [m.key_name, m]));
const itemByKey = new Map(db.items.map((i) => [i.key_name, i]));
const fluidByKey = new Map(db.fluids.map((f) => [f.key_name, f]));
const recipeByKey = new Map(db.recipes.map((r) => [r.key_name, r]));
const resourceByKey = new Map(db.resources.map((r) => [r.key_name, r]));

// Items + fluids for "get anything by key"
const itemOrFluidByKey = new Map<KeyName, Item | Fluid>([
  ...db.items.map((i) => [i.key_name, i] as const),
  ...db.fluids.map((f) => [f.key_name, f] as const),
]);

// Recipes by output (what recipes produce a given item)
const recipesByProduct = new Map<KeyName, Recipe[]>();
for (const recipe of db.recipes) {
  for (const [productKey] of recipe.products) {
    const existing = recipesByProduct.get(productKey) ?? [];
    existing.push(recipe);
    recipesByProduct.set(productKey, existing);
  }
}

// Recipes by building category
const recipesByCategory = new Map<string, Recipe[]>();
for (const recipe of db.recipes) {
  const existing = recipesByCategory.get(recipe.category) ?? [];
  existing.push(recipe);
  recipesByCategory.set(recipe.category, existing);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getBelt(keyName: string): Belt | undefined {
  return beltByKey.get(keyName);
}

export function getPipe(keyName: string): Pipe | undefined {
  return pipeByKey.get(keyName);
}

export function getBuilding(keyName: string): Building | undefined {
  return buildingByKey.get(keyName);
}

export function getMiner(keyName: string): Miner | undefined {
  return minerByKey.get(keyName);
}

export function getItem(keyName: KeyName): Item | undefined {
  return itemByKey.get(keyName);
}

export function getFluid(keyName: KeyName): Fluid | undefined {
  return fluidByKey.get(keyName);
}

export function getItemOrFluid(keyName: KeyName): Item | Fluid | undefined {
  return itemOrFluidByKey.get(keyName);
}

export function getRecipe(keyName: string): Recipe | undefined {
  return recipeByKey.get(keyName);
}

export function getResource(keyName: KeyName): Resource | undefined {
  return resourceByKey.get(keyName);
}

export function getRecipesForProduct(productKey: KeyName): Recipe[] {
  return recipesByProduct.get(productKey) ?? [];
}

/** Recipes that consume a given item as an ingredient */
export function getRecipesConsuming(ingredientKey: KeyName): Recipe[] {
  return db.recipes.filter((r) =>
    r.ingredients.some(([k]) => k === ingredientKey)
  );
}

export function getRecipesForBuilding(category: string): Recipe[] {
  return recipesByCategory.get(category) ?? [];
}

export function getBuildingForRecipe(recipe: Recipe): Building | undefined {
  return db.buildings.find((b) => b.category === recipe.category);
}

/** Convert recipe quantities (per cycle) to per-minute */
export function recipePerMinute(recipe: Recipe): { ingredients: [KeyName, number][]; products: [KeyName, number][] } {
  const factor = 60 / recipe.time;
  return {
    ingredients: recipe.ingredients.map(([k, q]) => [k, q * factor] as [KeyName, number]),
    products: recipe.products.map(([k, q]) => [k, q * factor] as [KeyName, number]),
  };
}

// ---------------------------------------------------------------------------
// Full lists (for dropdowns, filters)
// ---------------------------------------------------------------------------

export function getAllBelts(): Belt[] {
  return db.belts;
}

export function getAllPipes(): Pipe[] {
  return db.pipes;
}

export function getAllBuildings(): Building[] {
  return db.buildings;
}

export function getAllMiners(): Miner[] {
  return db.miners;
}

export function getAllItems(): Item[] {
  return db.items;
}

export function getAllFluids(): Fluid[] {
  return db.fluids;
}

export function getAllRecipes(): Recipe[] {
  return db.recipes;
}

export function getAllResources(): Resource[] {
  return db.resources;
}

// ---------------------------------------------------------------------------
// Raw database (for advanced use)
// ---------------------------------------------------------------------------

export function getDb(): SatisfactoryData {
  return db;
}

/** Game version this data targets. Source: KirkMcDonald/satisfactory-calculator, Oct 2024 */
export const DATA_VERSION = "1.0" as const;
