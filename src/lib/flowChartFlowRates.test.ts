import { describe, expect, it } from "vitest";
import { getMachineOptionsForProduct } from "./chain";
import { createFlowNode, createTreeNode } from "./flowChartModel";
import { computeFlowRates } from "./flowChartFlowRates";
import type { FlowRateData } from "./flowChartFlowTypes";
import type { KeyName } from "./types";

function createNodeForProductAndRecipe(productKey: KeyName, recipeKey: string, count = 1) {
  const option = getMachineOptionsForProduct(productKey).find((x) => x.recipeKey === recipeKey);
  if (!option) {
    throw new Error(`Missing machine option for ${productKey}:${recipeKey}`);
  }
  const flow = createFlowNode(
    option.outputItemKey,
    option.buildingKey,
    option.buildingName,
    option.outputPerMachine,
    count,
    100,
    {
      recipeKey: option.recipeKey,
      recipeName: option.recipeName,
      inputPerMachine: option.inputPerMachine,
    }
  );
  return createTreeNode(flow, null, []);
}

describe("computeFlowRates byproduct handling", () => {
  it("blocks refinery output when a byproduct has no consumer", () => {
    const plastic = createNodeForProductAndRecipe("plastic", "plastic");
    const rates = computeFlowRates(plastic, new Map<KeyName, number>([["crude-oil", 30]]));
    const plasticRate = rates.get(plastic.id) as FlowRateData;
    expect(plasticRate.currentOutput).toBe(0);
  });

  it("allows refinery output when byproduct has a consumer in the same factory", () => {
    const plastic = createNodeForProductAndRecipe("plastic", "plastic");
    const petroleumCoke = createNodeForProductAndRecipe("petroleum-coke", "petroleum-coke");
    petroleumCoke.parentId = plastic.id;
    plastic.children = [petroleumCoke];

    const rates = computeFlowRates(plastic, new Map<KeyName, number>([["crude-oil", 30]]));
    const plasticRate = rates.get(plastic.id) as FlowRateData;
    const cokeRate = rates.get(petroleumCoke.id) as FlowRateData;

    expect(plasticRate.currentOutput).toBeGreaterThan(0);
    const heavyOilByproduct = plasticRate.outputs?.find((o) => o.itemKey === "heavy-oil-residue");
    expect(heavyOilByproduct?.currentOutput ?? 0).toBeGreaterThan(0);
    expect(cokeRate.currentOutput).toBeGreaterThan(0);
  });

  it("throttles byproduct producers to downstream sink capacity", () => {
    const plastic = createNodeForProductAndRecipe("plastic", "plastic", 3);
    const rubber = createNodeForProductAndRecipe("rubber", "rubber", 2);
    const fuel = createNodeForProductAndRecipe("fuel", "residual-fuel");
    rubber.parentId = plastic.id;
    fuel.parentId = plastic.id;
    plastic.children = [rubber, fuel];

    const rates = computeFlowRates(plastic, new Map<KeyName, number>([["crude-oil", 150]]));
    const plasticRate = rates.get(plastic.id) as FlowRateData;
    const rubberRate = rates.get(rubber.id) as FlowRateData;
    const fuelRate = rates.get(fuel.id) as FlowRateData;

    const plasticByproduct = plasticRate.outputs?.find((o) => o.itemKey === "heavy-oil-residue")?.currentOutput ?? 0;
    const rubberByproduct = rubberRate.outputs?.find((o) => o.itemKey === "heavy-oil-residue")?.currentOutput ?? 0;
    const totalByproduct = plasticByproduct + rubberByproduct;
    const plasticByproductMax = plasticRate.outputs?.find((o) => o.itemKey === "heavy-oil-residue")?.maxOutput ?? 0;
    const rubberByproductMax = rubberRate.outputs?.find((o) => o.itemKey === "heavy-oil-residue")?.maxOutput ?? 0;
    const maxPotentialByproduct = plasticByproductMax + rubberByproductMax;

    expect(maxPotentialByproduct).toBeGreaterThan(60);
    expect(totalByproduct).toBeCloseTo(60, 3);
    expect(totalByproduct).toBeLessThan(maxPotentialByproduct - 0.001);
    expect(fuelRate.currentOutput).toBeCloseTo(fuelRate.maxOutput, 3);
  });
});
