import { describe, it, expect } from "vitest";
import { createFlowNode, createTreeNode, type TreeNode } from "./flowChartModel";
import { resolveSupplierIds, getFlowSlices } from "./flowChartTree";
import { getMachineOptionsForProduct, getExtractorMachineOptionsFull } from "./chain";

function ironOreMinerSmelterPlateTree(childOrder: "smelt-first" | "plate-first"): TreeNode {
  const minerOpt = getExtractorMachineOptionsFull().find((x) => x.outputItemKey === "iron-ore")!;
  const ingotOpt = getMachineOptionsForProduct("iron-ingot")[0]!;
  const plateOpt = getMachineOptionsForProduct("iron-plate")[0]!;

  const minerFlow = createFlowNode(
    minerOpt.outputItemKey,
    minerOpt.buildingKey,
    minerOpt.buildingName,
    minerOpt.outputPerMachine,
    1,
    100,
    {
      recipeKey: minerOpt.recipeKey,
      recipeName: minerOpt.recipeName,
      inputPerMachine: 0,
      isRaw: true,
    }
  );
  const smeltFlow = createFlowNode(
    ingotOpt.outputItemKey,
    ingotOpt.buildingKey,
    ingotOpt.buildingName,
    ingotOpt.outputPerMachine,
    1,
    100,
    {
      recipeKey: ingotOpt.recipeKey,
      recipeName: ingotOpt.recipeName,
      inputPerMachine: ingotOpt.inputPerMachine,
    }
  );
  const plateFlow = createFlowNode(
    plateOpt.outputItemKey,
    plateOpt.buildingKey,
    plateOpt.buildingName,
    plateOpt.outputPerMachine,
    1,
    100,
    {
      recipeKey: plateOpt.recipeKey,
      recipeName: plateOpt.recipeName,
      inputPerMachine: plateOpt.inputPerMachine,
    }
  );

  const smeltTn = createTreeNode(smeltFlow, minerFlow.id, []);
  const plateTn = createTreeNode(plateFlow, minerFlow.id, []);
  const children = childOrder === "smelt-first" ? [smeltTn, plateTn] : [plateTn, smeltTn];
  return createTreeNode(minerFlow, null, children);
}

describe("resolveSupplierIds", () => {
  it("finds a supplier earlier in the same horizontal slice (sibling before consumer)", () => {
    const tree = ironOreMinerSmelterPlateTree("smelt-first");
    const slices = getFlowSlices(tree);
    expect(slices.length).toBeGreaterThanOrEqual(2);
    const plateTn = tree.children.find((c) => c.node.outputItemKey === "iron-plate")!;
    const smeltTn = tree.children.find((c) => c.node.outputItemKey === "iron-ingot")!;
    expect(plateTn).toBeTruthy();
    expect(smeltTn).toBeTruthy();

    const ids = resolveSupplierIds(tree, plateTn, "iron-ingot");
    expect(ids).toContain(smeltTn.id);
  });

  it("does not use a same-slice producer that appears after the consumer in slice order", () => {
    const tree = ironOreMinerSmelterPlateTree("plate-first");
    const plateTn = tree.children.find((c) => c.node.outputItemKey === "iron-plate")!;
    const smeltTn = tree.children.find((c) => c.node.outputItemKey === "iron-ingot")!;

    const ids = resolveSupplierIds(tree, plateTn, "iron-ingot");
    expect(ids).not.toContain(smeltTn.id);
    expect(ids.length).toBe(0);
  });
});
