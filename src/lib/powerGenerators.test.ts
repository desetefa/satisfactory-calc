import { describe, expect, it } from "vitest";
import { getMachineOptionsForInput, getRecipeInputsPerMinute } from "./chain";

describe("power generator extensions", () => {
  it("exposes Fuel Generator options for fuel inputs", () => {
    const opts = getMachineOptionsForInput("fuel");
    const fuelGen = opts.find((o) => o.recipeKey === "_power_fuel-generator_fuel");
    expect(fuelGen).toBeTruthy();
    expect(fuelGen?.buildingKey).toBe("fuel-generator");
    expect(fuelGen?.outputItemKey).toBe("power");
  });

  it("returns pseudo-recipe inputs for generator options", () => {
    const inputs = getRecipeInputsPerMinute("_power_fuel-generator_fuel");
    expect(inputs).toEqual([{ itemKey: "fuel", perMinute: 20 }]);
  });
});

