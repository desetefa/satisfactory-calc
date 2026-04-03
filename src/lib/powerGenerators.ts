import type { KeyName } from "@/lib/types";

export const POWER_ITEM_KEY = "power" as KeyName;

export type PowerGeneratorOption = {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
  inputsPerMinute: { itemKey: KeyName; perMinute: number }[];
};

const POWER_GENERATOR_OPTIONS: PowerGeneratorOption[] = [
  {
    recipeKey: "_power_coal-generator_coal",
    recipeName: "Coal Generator (Coal)",
    buildingKey: "coal-generator",
    buildingName: "Coal Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 75,
    inputPerMachine: 45,
    inputsPerMinute: [
      { itemKey: "coal", perMinute: 15 },
      { itemKey: "water", perMinute: 45 },
    ],
  },
  {
    recipeKey: "_power_coal-generator_compacted-coal",
    recipeName: "Coal Generator (Compacted Coal)",
    buildingKey: "coal-generator",
    buildingName: "Coal Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 75,
    inputPerMachine: 45,
    inputsPerMinute: [
      { itemKey: "compacted-coal", perMinute: 7.1 },
      { itemKey: "water", perMinute: 45 },
    ],
  },
  {
    recipeKey: "_power_coal-generator_petroleum-coke",
    recipeName: "Coal Generator (Petroleum Coke)",
    buildingKey: "coal-generator",
    buildingName: "Coal Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 75,
    inputPerMachine: 45,
    inputsPerMinute: [
      { itemKey: "petroleum-coke", perMinute: 25 },
      { itemKey: "water", perMinute: 45 },
    ],
  },
  {
    recipeKey: "_power_fuel-generator_fuel",
    recipeName: "Fuel Generator (Fuel)",
    buildingKey: "fuel-generator",
    buildingName: "Fuel Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 250,
    inputPerMachine: 20,
    inputsPerMinute: [{ itemKey: "fuel", perMinute: 20 }],
  },
  {
    recipeKey: "_power_fuel-generator_liquid-biofuel",
    recipeName: "Fuel Generator (Liquid Biofuel)",
    buildingKey: "fuel-generator",
    buildingName: "Fuel Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 250,
    inputPerMachine: 13.3,
    inputsPerMinute: [{ itemKey: "liquid-biofuel", perMinute: 13.3 }],
  },
  {
    recipeKey: "_power_fuel-generator_turbofuel",
    recipeName: "Fuel Generator (Turbofuel)",
    buildingKey: "fuel-generator",
    buildingName: "Fuel Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 250,
    inputPerMachine: 7.5,
    inputsPerMinute: [{ itemKey: "turbofuel", perMinute: 7.5 }],
  },
  {
    recipeKey: "_power_fuel-generator_rocket-fuel",
    recipeName: "Fuel Generator (Rocket Fuel)",
    buildingKey: "fuel-generator",
    buildingName: "Fuel Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 250,
    inputPerMachine: 4.2,
    inputsPerMinute: [{ itemKey: "rocket-fuel", perMinute: 4.2 }],
  },
  {
    recipeKey: "_power_fuel-generator_ionized-fuel",
    recipeName: "Fuel Generator (Ionized Fuel)",
    buildingKey: "fuel-generator",
    buildingName: "Fuel Generator",
    outputItemKey: POWER_ITEM_KEY,
    outputPerMachine: 250,
    inputPerMachine: 3,
    inputsPerMinute: [{ itemKey: "ionized-fuel", perMinute: 3 }],
  },
];

const POWER_OPTIONS_BY_INPUT = new Map<KeyName, PowerGeneratorOption[]>();
for (const option of POWER_GENERATOR_OPTIONS) {
  for (const input of option.inputsPerMinute) {
    const list = POWER_OPTIONS_BY_INPUT.get(input.itemKey) ?? [];
    list.push(option);
    POWER_OPTIONS_BY_INPUT.set(input.itemKey, list);
  }
}

const POWER_OPTION_BY_RECIPE = new Map(
  POWER_GENERATOR_OPTIONS.map((option) => [option.recipeKey, option] as const)
);

export function getPowerGeneratorOptionsForInput(inputItemKey: KeyName): PowerGeneratorOption[] {
  return POWER_OPTIONS_BY_INPUT.get(inputItemKey) ?? [];
}

export function getPowerGeneratorInputsPerMinute(
  recipeKey: string
): { itemKey: KeyName; perMinute: number }[] | null {
  return POWER_OPTION_BY_RECIPE.get(recipeKey)?.inputsPerMinute ?? null;
}

