import { describe, it, expect } from "vitest";
import { planProductionFromTarget } from "./productionPlanner";
import { productionPlanToSliceTree } from "./plannerToTree";

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
