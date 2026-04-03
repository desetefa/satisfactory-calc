import { describe, it, expect } from "vitest";
import { planProductionFromTarget } from "./productionPlanner";
import { productionPlanToSliceTree } from "./plannerToTree";
import { getMachineOptionsForProduct, getRecipeInputsPerMinute } from "./chain";
import { getAllProductKeysWithRecipes } from "./chain";
import { getRecipe, recipePerMinute } from "./db";

describe("planProductionFromTarget", () => {
  it("plans iron plate for one machine @ 100%", () => {
    const res = planProductionFromTarget({
      productKey: "iron-plate",
      recipeKey: "iron-plate",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.groups.length).toBeGreaterThanOrEqual(2);
    expect(res.plan.edges.length).toBeGreaterThanOrEqual(1);
    expect(res.plan.targetGroupId).toBeTruthy();
    const target = res.plan.groups.find((g) => g.id === res.plan.targetGroupId);
    expect(target?.machineCount).toBe(1);
    expect(target?.outputItemKey).toBe("iron-plate");
  });

  it("plans encased industrial beam (two ingredients)", () => {
    const res = planProductionFromTarget({
      productKey: "encased-industrial-beam",
      recipeKey: "encased-industrial-beam",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.groups.length).toBeGreaterThan(3);
    const toTarget = res.plan.edges.filter((e) => e.consumerGroupId === res.plan.targetGroupId);
    expect(toTarget.length).toBe(2);
  });

  it("plans standalone extractor", () => {
    const res = planProductionFromTarget(
      {
        productKey: "iron-ore",
        recipeKey: "_raw_iron-ore_miner-mk2",
      },
      { minerKey: "miner-mk2" }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.groups).toHaveLength(1);
    expect(res.plan.rootGroupIds).toHaveLength(1);
  });
});

describe("productionPlanToSliceTree", () => {
  it("builds a tree from iron plate plan", () => {
    const planned = planProductionFromTarget({
      productKey: "iron-plate",
      recipeKey: "iron-plate",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { tree, targetNodeId } = productionPlanToSliceTree(planned.plan);
    expect(tree.node.outputItemKey).toBeTruthy();
    expect(targetNodeId).toBeTruthy();
  });

  it("builds a tree from encased industrial beam plan", () => {
    const planned = planProductionFromTarget({
      productKey: "encased-industrial-beam",
      recipeKey: "encased-industrial-beam",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { tree, targetNodeId } = productionPlanToSliceTree(planned.plan);
    const findById = (t: typeof tree, id: string): boolean => {
      if (t.node.id === id) return true;
      return t.children.some((c) => findById(c, id));
    };
    expect(findById(tree, targetNodeId)).toBe(true);
    const targetTn =
      planned.plan.groups.find((g) => g.id === planned.plan.targetGroupId) &&
      (() => {
        function walk(t: typeof tree): (typeof tree) | null {
          if (t.node.id === targetNodeId) return t;
          for (const c of t.children) {
            const f = walk(c);
            if (f) return f;
          }
          return null;
        }
        return walk(tree);
      })();
    expect(targetTn?.inputEdges?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("quick build planner coverage", () => {
  it("is deterministic for every quick-build recipe option and converts all successful plans", () => {
    const allTargets = getAllProductKeysWithRecipes().flatMap((productKey) =>
      getMachineOptionsForProduct(productKey).map((opt) => ({
        productKey,
        recipeKey: opt.recipeKey,
      }))
    );

    let successCount = 0;
    for (const target of allTargets) {
      const first = planProductionFromTarget(target, { minerKey: "miner-mk2" });
      const second = planProductionFromTarget(target, { minerKey: "miner-mk2" });
      expect(first.ok).toBe(second.ok);
      if (!first.ok || !second.ok) continue;
      successCount += 1;
      expect(first.plan.groups.length).toBe(second.plan.groups.length);
      expect(first.plan.edges.length).toBe(second.plan.edges.length);
      const { tree, targetNodeId } = productionPlanToSliceTree(first.plan);
      expect(tree.node.outputItemKey).toBeTruthy();
      expect(targetNodeId).toBeTruthy();
    }
    expect(successCount).toBeGreaterThan(0);
  });

  it("produces enough aggregate supply for every ingredient demand", () => {
    const allTargets = getAllProductKeysWithRecipes().flatMap((productKey) =>
      getMachineOptionsForProduct(productKey).map((opt) => ({
        productKey,
        recipeKey: opt.recipeKey,
      }))
    );

    for (const target of allTargets) {
      const planned = planProductionFromTarget(target, { minerKey: "miner-mk2" });
      if (!planned.ok) continue;

      const produced = new Map<string, number>();
      const demanded = new Map<string, number>();

      for (const g of planned.plan.groups) {
        if (g.recipeKey.startsWith("_raw_")) {
          produced.set(
            g.outputItemKey,
            (produced.get(g.outputItemKey) ?? 0) + g.outputPerMachine * g.machineCount
          );
          continue;
        }

        const recipe = getRecipe(g.recipeKey);
        if (!recipe) continue;
        const rates = recipePerMinute(recipe);
        for (const [productKey, perMin] of rates.products) {
          produced.set(productKey, (produced.get(productKey) ?? 0) + perMin * g.machineCount);
        }

        for (const input of getRecipeInputsPerMinute(g.recipeKey)) {
          demanded.set(input.itemKey, (demanded.get(input.itemKey) ?? 0) + input.perMinute * g.machineCount);
        }
      }

      for (const [itemKey, need] of demanded) {
        const supply = produced.get(itemKey) ?? 0;
        expect(
          supply + 1e-6 >= need,
          `insufficient supply for ${itemKey} in ${target.productKey} via ${target.recipeKey}: ${supply} < ${need}`
        ).toBe(true);
      }
    }
  });
});
