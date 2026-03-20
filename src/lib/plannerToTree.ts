/**
 * Convert a {@link ProductionPlan} into a {@link TreeNode} graph for horizontal flow
 * (spine + inputEdges for extra suppliers; extra raw roots as siblings under first root).
 */

import type { KeyName } from "./types";
import type { ProductionPlan, PlannedMachineGroup } from "./productionPlanner";
import { getRecipe, getBuildingForRecipe, recipePerMinute, getMiner, getBuilding, getAllBelts } from "./db";
import { createFlowNode, flowItemName, type TreeNode, type InputEdge } from "./flowChartModel";

function pickDefaultBelt(throughput: number): string {
  const belts = getAllBelts().sort((a, b) => a.rate - b.rate);
  const match = belts.find((b) => b.rate >= throughput);
  return match?.key_name ?? belts[belts.length - 1]?.key_name ?? "belt1";
}

function flowNodeFromGroup(g: PlannedMachineGroup): ReturnType<typeof createFlowNode> {
  if (g.recipeKey.startsWith("_raw_")) {
    const miner = getMiner(g.buildingKey);
    const building = getBuilding(g.buildingKey);
    const name = building?.name ?? miner?.name ?? g.buildingKey;
    return createFlowNode(
      g.outputItemKey,
      g.buildingKey,
      name,
      g.outputPerMachine,
      g.machineCount,
      g.clockPercent,
      {
        recipeKey: g.recipeKey,
        recipeName: flowItemName(g.outputItemKey),
        inputPerMachine: 0,
        isRaw: true,
      }
    );
  }

  const recipe = getRecipe(g.recipeKey);
  if (!recipe) {
    throw new Error(`Missing recipe ${g.recipeKey}`);
  }
  const building = getBuildingForRecipe(recipe) ?? getBuilding(g.buildingKey);
  const { ingredients, products } = recipePerMinute(recipe);
  const outLine = products.find(([k]) => k === g.outputItemKey);
  const outputPerMachine = outLine?.[1] ?? g.outputPerMachine;
  const inputPerMachine =
    ingredients.length > 0 ? Math.max(...ingredients.map(([, q]) => q)) : 0;

  return createFlowNode(
    g.outputItemKey,
    g.buildingKey,
    building?.name ?? g.buildingKey,
    outputPerMachine,
    g.machineCount,
    g.clockPercent,
    {
      recipeKey: g.recipeKey,
      recipeName: recipe.name,
      inputPerMachine,
      isRaw: false,
    }
  );
}

function computeDepths(
  groups: PlannedMachineGroup[],
  edges: { producerGroupId: string; consumerGroupId: string }[]
): Map<string, number> {
  const ids = new Set(groups.map((g) => g.id));
  const incomingConsumer = new Set(edges.map((e) => e.consumerGroupId));
  const depth = new Map<string, number>();

  for (const g of groups) {
    if (!incomingConsumer.has(g.id)) {
      depth.set(g.id, 0);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!ids.has(e.producerGroupId) || !ids.has(e.consumerGroupId)) continue;
      const pd = depth.get(e.producerGroupId);
      if (pd === undefined) continue;
      const next = pd + 1;
      const cur = depth.get(e.consumerGroupId);
      if (cur === undefined || next > cur) {
        depth.set(e.consumerGroupId, next);
        changed = true;
      }
    }
  }

  for (const g of groups) {
    if (!depth.has(g.id)) depth.set(g.id, 0);
  }
  return depth;
}

export function productionPlanToSliceTree(plan: ProductionPlan): { tree: TreeNode; targetNodeId: string } {
  const { groups, edges, rootGroupIds, targetGroupId } = plan;
  const depth = computeDepths(groups, edges);
  const nodeById = new Map<string, TreeNode>();

  for (const g of groups) {
    const flow = flowNodeFromGroup(g);
    const belt = pickDefaultBelt(flow.outputPerMachine * flow.count);
    nodeById.set(g.id, {
      id: flow.id,
      node: flow,
      children: [],
      parentId: null,
      incomingBeltKey: belt,
    });
  }

  const rootsSorted = [...rootGroupIds].sort();
  if (rootsSorted.length === 0) {
    throw new Error("Plan has no root producers");
  }

  const treeRoot = nodeById.get(rootsSorted[0]!)!;
  for (const rid of rootsSorted.slice(1)) {
    const child = nodeById.get(rid);
    if (!child) continue;
    child.parentId = treeRoot.id;
    treeRoot.children.push(child);
  }

  const nonRoots = groups
    .filter((g) => !rootsSorted.includes(g.id))
    .sort((a, b) => {
      const da = depth.get(a.id) ?? 0;
      const db = depth.get(b.id) ?? 0;
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });

  for (const g of nonRoots) {
    const incoming = edges.filter((e) => e.consumerGroupId === g.id);
    if (incoming.length === 0) continue;

    const producerIds = [...new Set(incoming.map((e) => e.producerGroupId))];
    const mainProducer = producerIds.reduce((best, p) =>
      (depth.get(p) ?? 0) > (depth.get(best) ?? 0) ? p : best
    );

    const self = nodeById.get(g.id)!;
    const parent = nodeById.get(mainProducer)!;
    const recipe = getRecipe(g.recipeKey);
    const { ingredients } = recipe ? recipePerMinute(recipe) : { ingredients: [] as [KeyName, number][] };

    const mainEdge = incoming.find((e) => e.producerGroupId === mainProducer);
    const mainIngPerMin =
      mainEdge && ingredients.length > 0
        ? (ingredients.find(([k]) => k === mainEdge.itemKey)?.[1] ?? self.node.inputPerMachine ?? 0)
        : (self.node.inputPerMachine ?? 0);

    self.parentId = parent.id;
    self.incomingBeltKey = pickDefaultBelt(mainIngPerMin * self.node.count);

    const inputEdges: InputEdge[] = [];
    for (const e of incoming) {
      if (e.producerGroupId === mainProducer) continue;
      const ingPerMin =
        ingredients.find(([k]) => k === e.itemKey)?.[1] ?? self.node.inputPerMachine ?? 60;
      const prodTn = nodeById.get(e.producerGroupId);
      if (!prodTn) throw new Error(`Missing producer ${e.producerGroupId} for input edge`);
      inputEdges.push({
        itemKey: e.itemKey,
        producerId: prodTn.node.id,
        beltKey: pickDefaultBelt(ingPerMin * self.node.count),
      });
    }
    if (inputEdges.length > 0) {
      self.inputEdges = inputEdges;
    }

    parent.children.push(self);
  }

  const targetTn = nodeById.get(targetGroupId);
  if (!targetTn) throw new Error("Target group not found in tree");

  return { tree: treeRoot, targetNodeId: targetTn.node.id };
}
