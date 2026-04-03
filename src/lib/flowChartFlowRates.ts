import { getRecipeInputsPerMinute } from "@/lib/chain";
import { getRecipe, recipePerMinute } from "@/lib/db";
import { getItemDisplayName } from "@/lib/itemDisplayName";
import type { TreeNode } from "@/lib/flowChartModel";
import {
  getEffectiveOutputPerMachine,
  getTotalClockFraction,
} from "@/lib/flowChartModel";
import type { KeyName } from "@/lib/types";
import { findNode, getFlowSlices } from "@/lib/flowChartTree";
import type { FlowInputData, FlowOutputData, FlowRateData } from "@/lib/flowChartFlowTypes";
import { getTransportRateForItem } from "@/lib/flowTransport";

/** Flatten tree preorder (root first). */
export function getAllNodes(tree: TreeNode): TreeNode[] {
  return [tree, ...tree.children.flatMap((c) => getAllNodes(c))];
}

export function getChildDemandForParentOutput(child: TreeNode, parentOutputItemKey: KeyName): number {
  if (child.node.isRaw || !child.node.recipeKey) return 0;
  const inputs = getRecipeInputsPerMinute(child.node.recipeKey);
  const match = inputs.find((i) => i.itemKey === parentOutputItemKey);
  const directNeed = (match?.perMinute ?? 0) * getTotalClockFraction(child.node);

  if (child.children.length === 0) return directNeed;

  const outputItemKey = child.node.outputItemKey;
  if (!outputItemKey) return directNeed;

  let downstreamOutputNeed = 0;
  for (const grandchild of child.children) {
    downstreamOutputNeed += getChildDemandForParentOutput(grandchild, outputItemKey);
  }

  const recipe = getRecipe(child.node.recipeKey);
  if (!recipe || !match) return directNeed;

  const { products } = recipePerMinute(recipe);
  const outputPerMin = products.find(([k]) => k === outputItemKey)?.[1] ?? 0;
  if (outputPerMin <= 0) return directNeed;

  const inputNeededForDownstream =
    downstreamOutputNeed * (match.perMinute / outputPerMin);

  return Math.max(directNeed, inputNeededForDownstream);
}

export function getSlicesForFlow(tree: TreeNode): TreeNode[][] {
  return getFlowSlices(tree);
}

/**
 * Single-pass pool simulation uses slice order; without reordering, a consumer can run
 * before a same-slice producer (e.g. R. Iron Plate before Screw constructors) and see 0 supply.
 * Topological order: every producer of an item runs before consumers in this slice that need it.
 */
export function sortSliceNodesForFlow(sliceNodes: TreeNode[]): TreeNode[] {
  const index = new Map(sliceNodes.map((n, i) => [n.id, i]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const nodeOutputKeys = new Map<string, Set<KeyName>>();

  for (const n of sliceNodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
    if (n.node.recipeKey && !n.node.isRaw) {
      const recipe = getRecipe(n.node.recipeKey);
      if (recipe) {
        nodeOutputKeys.set(
          n.id,
          new Set(recipePerMinute(recipe).products.map(([itemKey]) => itemKey))
        );
        continue;
      }
    }
    nodeOutputKeys.set(n.id, new Set(n.node.outputItemKey ? [n.node.outputItemKey] : []));
  }

  const addEdge = (from: string, to: string) => {
    if (from === to) return;
    const outs = outgoing.get(from)!;
    if (!outs.includes(to)) {
      outs.push(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  };

  for (const c of sliceNodes) {
    if (c.node.isRaw || !c.node.recipeKey) continue;
    for (const { itemKey } of getRecipeInputsPerMinute(c.node.recipeKey)) {
      for (const p of sliceNodes) {
        if (p.id === c.id) continue;
        if (nodeOutputKeys.get(p.id)?.has(itemKey)) {
          addEdge(p.id, c.id);
        }
      }
    }
  }

  const result: TreeNode[] = [];
  const done = new Set<string>();

  while (result.length < sliceNodes.length) {
    const ready = sliceNodes
      .filter((n) => !done.has(n.id) && (indegree.get(n.id) ?? 0) === 0)
      .sort((a, b) => index.get(a.id)! - index.get(b.id)!);
    if (ready.length === 0) {
      const rest = sliceNodes
        .filter((n) => !done.has(n.id))
        .sort((a, b) => index.get(a.id)! - index.get(b.id)!);
      for (const n of rest) {
        result.push(n);
        done.add(n.id);
      }
      break;
    }
    const next = ready[0]!;
    result.push(next);
    done.add(next.id);
    for (const to of outgoing.get(next.id) ?? []) {
      indegree.set(to, (indegree.get(to) ?? 0) - 1);
    }
  }
  return result;
}

export function computeFlowRates(
  tree: TreeNode,
  /** Items/min supplied to this factory externally (e.g. from factory imports). Pre-seeds the item pool. */
  externalSupply?: Map<KeyName, number>
): Map<string, FlowRateData | { parentSending: number }> {
  const result = new Map<string, FlowRateData | { parentSending: number }>();
  const slices = getSlicesForFlow(tree);
  if (slices.length === 0) return result;

  const pools = new Map<KeyName, number>(externalSupply);
  const remainingDemandByItem = new Map<KeyName, number>();
  for (const n of getAllNodes(tree)) {
    if (!n.node.recipeKey || n.node.isRaw) continue;
    for (const input of getRecipeInputsPerMinute(n.node.recipeKey)) {
      remainingDemandByItem.set(
        input.itemKey,
        (remainingDemandByItem.get(input.itemKey) ?? 0) + input.perMinute * getTotalClockFraction(n.node)
      );
    }
  }

  for (let sliceIdx = 0; sliceIdx < slices.length; sliceIdx++) {
    const sliceNodes = sortSliceNodesForFlow(slices[sliceIdx]!);

    for (const node of sliceNodes) {
      if (node.node.isRaw || !node.node.recipeKey) {
        const out = getEffectiveOutputPerMachine(node.node) * getTotalClockFraction(node.node);
        const key = node.node.outputItemKey;
        if (key) pools.set(key, (pools.get(key) ?? 0) + out);
        result.set(node.id, { parentSending: out });
        continue;
      }

      const recipeInputs = getRecipeInputsPerMinute(node.node.recipeKey);
      const clockFrac = getTotalClockFraction(node.node);
      const recipe = getRecipe(node.node.recipeKey);
      const recipeOutputs = recipe ? recipePerMinute(recipe).products : [];
      // This node is no longer "future demand" once evaluated in this pass.
      for (const input of recipeInputs) {
        const prev = remainingDemandByItem.get(input.itemKey) ?? 0;
        remainingDemandByItem.set(input.itemKey, Math.max(0, prev - input.perMinute * clockFrac));
      }
      const inputs: FlowInputData[] = recipeInputs.map(({ itemKey, perMinute }) => ({
        itemKey,
        itemName: getItemDisplayName(itemKey, "compact"),
        needsInput: perMinute * clockFrac,
        receivesInput: 0,
      }));

      const parent = node.parentId ? findNode(tree, node.parentId) : null;

      // Pass 1: compute what's *available* per input independently (what flows to the machine).
      // This is independent of whether other inputs are present.
      for (const inp of inputs) {
        if (inp.needsInput <= 0) continue;
        const poolAvail = pools.get(inp.itemKey) ?? 0;
        let beltCap = 9999;
        if (parent?.node.outputItemKey === inp.itemKey) {
          beltCap = getTransportRateForItem(inp.itemKey, node.incomingBeltKey);
        } else {
          const edge = node.inputEdges?.find((e) => e.itemKey === inp.itemKey);
          if (edge) {
            beltCap = getTransportRateForItem(inp.itemKey, edge.beltKey);
          }
        }
        inp.receivesInput = Math.min(inp.needsInput, poolAvail, beltCap);
      }

      // Utilization = min ratio across all inputs.
      const withNeeds = inputs.filter((i) => i.needsInput > 0);
      let utilization =
        withNeeds.length > 0
          ? Math.min(1, ...withNeeds.map((i) => i.receivesInput / i.needsInput))
          : 1;

      // Byproducts must have downstream sink capacity (future demand not already satisfied by pool).
      for (const [itemKey, perMinute] of recipeOutputs) {
        if (itemKey === node.node.outputItemKey) continue;
        const byproductAtFullUtil = perMinute * clockFrac;
        if (byproductAtFullUtil <= 0) continue;
        const remainingDemand = remainingDemandByItem.get(itemKey) ?? 0;
        const poolAvail = pools.get(itemKey) ?? 0;
        const freeSinkCapacity = Math.max(0, remainingDemand - poolAvail);
        const byproductUtilCap = freeSinkCapacity / byproductAtFullUtil;
        utilization = Math.min(utilization, byproductUtilCap);
      }
      utilization = Math.max(0, Math.min(1, utilization));

      // Pass 2: deduct only actual consumption (need × utilization) from pool.
      // This leaves unconsumed supply available for later machines.
      for (const inp of inputs) {
        if (inp.needsInput <= 0) continue;
        const poolAvail = pools.get(inp.itemKey) ?? 0;
        pools.set(inp.itemKey, Math.max(0, poolAvail - inp.needsInput * utilization));
      }

      const maxOutput =
        getEffectiveOutputPerMachine(node.node) * getTotalClockFraction(node.node);
      const currentOutput = maxOutput * utilization;
      const outputs: FlowOutputData[] | undefined =
        recipeOutputs.length > 0
          ? recipeOutputs.map(([itemKey, perMinute]) => ({
              itemKey,
              itemName: getItemDisplayName(itemKey, "compact"),
              maxOutput: perMinute * clockFrac,
              currentOutput: perMinute * clockFrac * utilization,
              isPrimary: itemKey === node.node.outputItemKey,
            }))
          : undefined;
      const primaryInp = inputs.find((i) => parent?.node.outputItemKey === i.itemKey);
      const beltCapacity = parent?.node.outputItemKey
        ? getTransportRateForItem(parent.node.outputItemKey, node.incomingBeltKey)
        : 0;
      const parentSending =
        parent && result.has(parent.id)
          ? ((result.get(parent.id) as FlowRateData)?.currentOutput ?? 0)
          : 0;

      result.set(node.id, {
        parentSending,
        beltCapacity,
        needsInput: primaryInp?.needsInput ?? 0,
        receivesInput: primaryInp?.receivesInput ?? 0,
        inputs: inputs.length > 0 ? inputs : undefined,
        maxOutput,
        currentOutput,
        outputs,
        utilization,
      });

      const outKey = node.node.outputItemKey;
      if (outKey) pools.set(outKey, (pools.get(outKey) ?? 0) + currentOutput);
      if (recipeOutputs.length > 0) {
        for (const [productKey, perMinute] of recipeOutputs) {
          if (productKey === outKey) continue;
          const byproductRate = perMinute * clockFrac * utilization;
          if (byproductRate > 0) {
            pools.set(productKey, (pools.get(productKey) ?? 0) + byproductRate);
          }
        }
      }
    }
  }
  return result;
}

/** Produced / consumed rates from the same rules as Storage (per-item mass balance). */
export function computeFlowBalanceMaps(
  tree: TreeNode,
  flowRates: Map<string, FlowRateData | { parentSending: number }>
): { produced: Map<KeyName, number>; consumed: Map<KeyName, number> } {
  const produced = new Map<KeyName, number>();
  const consumed = new Map<KeyName, number>();
  for (const t of getAllNodes(tree)) {
    const fd = flowRates.get(t.id);
    const cfd = fd as FlowRateData | undefined;
    if (
      !t.node.isRaw &&
      t.node.recipeKey &&
      cfd &&
      "utilization" in cfd
    ) {
      const recipe = getRecipe(t.node.recipeKey);
      if (recipe) {
        const clockFrac = getTotalClockFraction(t.node);
        const { products } = recipePerMinute(recipe);
        for (const [itemKey, perMinute] of products) {
          const rate = perMinute * clockFrac * cfd.utilization;
          produced.set(itemKey, (produced.get(itemKey) ?? 0) + rate);
        }
      } else if (t.node.outputItemKey) {
        produced.set(
          t.node.outputItemKey,
          (produced.get(t.node.outputItemKey) ?? 0) + cfd.currentOutput
        );
      }
    } else if (t.node.outputItemKey) {
      let outputRate: number;
      if (fd && "currentOutput" in fd) {
        outputRate = (fd as FlowRateData).currentOutput;
      } else if (fd && "parentSending" in fd) {
        outputRate = (fd as { parentSending: number }).parentSending;
      } else {
        outputRate = getEffectiveOutputPerMachine(t.node) * getTotalClockFraction(t.node);
      }
      produced.set(t.node.outputItemKey, (produced.get(t.node.outputItemKey) ?? 0) + outputRate);
    }

    if (t.node.isRaw || !t.node.recipeKey) continue;
    if (!cfd || !("needsInput" in cfd)) continue;
    if (cfd.inputs && cfd.inputs.length > 0) {
      for (const inp of cfd.inputs) {
        const actualConsumed = inp.needsInput * cfd.utilization;
        consumed.set(inp.itemKey, (consumed.get(inp.itemKey) ?? 0) + actualConsumed);
      }
    } else if (cfd.receivesInput > 0) {
      const rIn = getRecipeInputsPerMinute(t.node.recipeKey);
      if (rIn.length === 1) {
        const ik = rIn[0]!.itemKey;
        consumed.set(ik, (consumed.get(ik) ?? 0) + cfd.receivesInput);
      }
    }
  }
  return { produced, consumed };
}
