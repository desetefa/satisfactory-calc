import { describe, it, expect } from "vitest";
import { createFlowNode, createTreeNode, type TreeNode } from "./flowChartModel";
import {
  resolveSupplierIds,
  getRelatedNodeIdsForHover,
  getFlowSlices,
  getDisplaySlices,
  moveNodeDisplaySlice,
  groupSliceNodesByParent,
} from "./flowChartTree";
import { getMachineOptionsForProduct, getExtractorMachineOptionsFull } from "./chain";
import { addChildToNode } from "./flowChartTreeMutations";

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

  it("finds same-slice producer even when it appears after the consumer in slice order", () => {
    const tree = ironOreMinerSmelterPlateTree("plate-first");
    const plateTn = tree.children.find((c) => c.node.outputItemKey === "iron-plate")!;
    const smeltTn = tree.children.find((c) => c.node.outputItemKey === "iron-ingot")!;

    const ids = resolveSupplierIds(tree, plateTn, "iron-ingot");
    expect(ids).toContain(smeltTn.id);
  });

  it("treats byproducts as valid supplier outputs for flow hover lineage", () => {
    const extractorOpt = getExtractorMachineOptionsFull().find((x) => x.outputItemKey === "crude-oil")!;
    const plasticOpt = getMachineOptionsForProduct("plastic").find((x) => x.recipeKey === "plastic")!;
    const fuelOpt = getMachineOptionsForProduct("fuel").find((x) => x.recipeKey === "residual-fuel")!;

    const crude = createFlowNode(
      extractorOpt.outputItemKey,
      extractorOpt.buildingKey,
      extractorOpt.buildingName,
      extractorOpt.outputPerMachine,
      1,
      100,
      { recipeKey: extractorOpt.recipeKey, recipeName: extractorOpt.recipeName, inputPerMachine: 0, isRaw: true }
    );
    const plastic = createFlowNode(
      plasticOpt.outputItemKey,
      plasticOpt.buildingKey,
      plasticOpt.buildingName,
      plasticOpt.outputPerMachine,
      1,
      100,
      { recipeKey: plasticOpt.recipeKey, recipeName: plasticOpt.recipeName, inputPerMachine: plasticOpt.inputPerMachine }
    );
    const fuel = createFlowNode(
      fuelOpt.outputItemKey,
      fuelOpt.buildingKey,
      fuelOpt.buildingName,
      fuelOpt.outputPerMachine,
      1,
      100,
      { recipeKey: fuelOpt.recipeKey, recipeName: fuelOpt.recipeName, inputPerMachine: fuelOpt.inputPerMachine }
    );
    const plasticTn = createTreeNode(plastic, crude.id, []);
    const fuelTn = createTreeNode(fuel, crude.id, []);
    const tree = createTreeNode(crude, null, [plasticTn, fuelTn]);

    const suppliers = resolveSupplierIds(tree, fuelTn, "heavy-oil-residue");
    expect(suppliers).toContain(plasticTn.id);

    const related = getRelatedNodeIdsForHover(tree, fuelTn.id);
    expect(related.has(plasticTn.id)).toBe(true);
    expect(related.has(tree.id)).toBe(true);
  });
});

describe("addChildToNode", () => {
  it("sets displaySliceIndex on the new child so it lands in the slice column where it was added", () => {
    const tree = ironOreMinerSmelterPlateTree("smelt-first");
    const plateOpt = getMachineOptionsForProduct("iron-plate")[0]!;
    const extra = createFlowNode(
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
    const next = addChildToNode(tree, tree.id, extra, tree.children.length, undefined, 2);
    const added = next.children.find((c) => c.id === extra.id);
    expect(added?.displaySliceIndex).toBe(2);
    const display = getDisplaySlices(next);
    expect(display[2]!.some((n) => n.id === extra.id)).toBe(true);
  });
});

describe("groupSliceNodesByParent", () => {
  it("uses tree structure so stale undefined/null parentId on children still share one branch stack", () => {
    const minerOpt = getExtractorMachineOptionsFull().find((x) => x.outputItemKey === "iron-ore")!;
    const ingotOpt = getMachineOptionsForProduct("iron-ingot")[0]!;
    const minerFlow = createFlowNode(
      minerOpt.outputItemKey,
      minerOpt.buildingKey,
      minerOpt.buildingName,
      minerOpt.outputPerMachine,
      1,
      100,
      { recipeKey: minerOpt.recipeKey, recipeName: minerOpt.recipeName, inputPerMachine: 0, isRaw: true }
    );
    const smeltFlow = createFlowNode(
      ingotOpt.outputItemKey,
      ingotOpt.buildingKey,
      ingotOpt.buildingName,
      ingotOpt.outputPerMachine,
      1,
      100,
      { recipeKey: ingotOpt.recipeKey, recipeName: ingotOpt.recipeName, inputPerMachine: ingotOpt.inputPerMachine }
    );
    const smeltA = createTreeNode(smeltFlow, minerFlow.id, []);
    const smeltB = createTreeNode(
      createFlowNode(
        ingotOpt.outputItemKey,
        ingotOpt.buildingKey,
        ingotOpt.buildingName,
        ingotOpt.outputPerMachine,
        1,
        100,
        { recipeKey: ingotOpt.recipeKey, recipeName: ingotOpt.recipeName, inputPerMachine: ingotOpt.inputPerMachine }
      ),
      minerFlow.id,
      []
    );
    const tree = createTreeNode(minerFlow, null, [smeltA, smeltB]);
    (smeltA as { parentId: string | null | undefined }).parentId = undefined;
    (smeltB as { parentId: string | null | undefined }).parentId = null;

    const groups = groupSliceNodesByParent(tree, [smeltA, smeltB]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parentId).toBe(minerFlow.id);
    expect(groups[0]!.nodes.map((n) => n.id)).toEqual([smeltA.id, smeltB.id]);
  });

  it("merges empty string and null parentId into one bucket when not in tree (fallback)", () => {
    const a = { id: "a", parentId: "" } as unknown as TreeNode;
    const b = { id: "b", parentId: null } as TreeNode;
    const stubRoot: TreeNode = {
      id: "stub-root",
      parentId: null,
      node: a.node,
      children: [],
    };
    const groups = groupSliceNodesByParent(stubRoot, [a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("getDisplaySlices / moveNodeDisplaySlice", () => {
  it("matches getFlowSlices when no displaySliceIndex overrides", () => {
    const tree = ironOreMinerSmelterPlateTree("smelt-first");
    const logical = getFlowSlices(tree);
    const display = getDisplaySlices(tree);
    expect(display.length).toBe(logical.length);
    for (let i = 0; i < logical.length; i++) {
      expect(display[i]!.map((n) => n.id).sort()).toEqual(logical[i]!.map((n) => n.id).sort());
    }
  });

  it("moves the sibling stack to the target column (all children get displaySliceIndex) without changing flow slices", () => {
    const tree = ironOreMinerSmelterPlateTree("smelt-first");
    const plateTn = tree.children.find((c) => c.node.outputItemKey === "iron-plate")!;
    const smeltTn = tree.children.find((c) => c.node.outputItemKey === "iron-ingot")!;
    const parentId = tree.id;
    const moved = moveNodeDisplaySlice(tree, parentId, plateTn.id, 2, null);
    const display = getDisplaySlices(moved);
    expect(display[2]!.some((n) => n.id === plateTn.id)).toBe(true);
    expect(display[2]!.some((n) => n.id === smeltTn.id)).toBe(true);
    expect(display[1]!.some((n) => n.id === plateTn.id)).toBe(false);
    expect(moved.children.every((c) => c.displaySliceIndex === 2)).toBe(true);
    const logical = getFlowSlices(moved);
    expect(logical.some((sl) => sl.some((n) => n.id === plateTn.id))).toBe(true);
  });
});
