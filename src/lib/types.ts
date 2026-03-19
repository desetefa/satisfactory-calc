/**
 * Satisfactory game data types
 * Source: KirkMcDonald/satisfactory-calculator (MIT)
 */

export type KeyName = string;

export interface Belt {
  name: string;
  key_name: string;
  rate: number; // items/min
}

export interface Pipe {
  name: string;
  key_name: string;
  rate: number; // m³/min
}

export interface Building {
  name: string;
  key_name: string;
  category: string;
  power: number;
  somersloop_slots: number | null;
  max: number;
  power_range?: [number, number];
}

export interface Miner {
  name: string;
  key_name: string;
  category: "mineral" | "oil" | "water";
  base_rate: number;
  power: number;
}

export interface Item {
  name: string;
  key_name: KeyName;
  tier: number;
  stack_size: number;
}

export interface Fluid {
  name: string;
  key_name: KeyName;
  tier: number;
}

export type Ingredient = [KeyName, number];  // [key_name, quantity per cycle]
export type Product = [KeyName, number];

export interface Recipe {
  name: string;
  key_name: string;
  category: string;
  time: number; // cycle time in seconds
  ingredients: Ingredient[];
  products: Product[];
}

export interface Resource {
  key_name: KeyName;
  category: string;
  priority: number;
  weight: number;
}

export interface SatisfactoryData {
  belts: Belt[];
  pipes: Pipe[];
  buildings: Building[];
  miners: Miner[];
  items: Item[];
  fluids: Fluid[];
  recipes: Recipe[];
  resources: Resource[];
}
