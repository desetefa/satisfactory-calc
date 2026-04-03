import { getRecipeInputsPerMinute } from "@/lib/chain";
import { computeFlowBalanceMaps, computeFlowRates, getAllNodes } from "@/lib/flowChartFlowRates";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import {
  getEffectiveOutputPerMachine,
  getMachineClocks,
  getTotalClockFraction,
  type TreeNode,
} from "@/lib/flowChartModel";
import type { KeyName } from "@/lib/types";
import { pickBeltAtLeastPreferred } from "@/lib/flowChartPickBelt";
import {
  recalcTree,
  synthesizeMissingInputEdges,
  updateChildBeltInTree,
  updateInputEdgeBeltInTree,
  updateNodeInTree,
} from "@/lib/flowChartTreeMutations";
import { findNode, resolveSupplierIds } from "@/lib/flowChartTree";

const STORAGE_BALANCE_EPS = 0.35;
const STORAGE_CLOCK_STEP = 5;

function findFirstProducerForItem(tree: TreeNode, itemKey: KeyName): TreeNode | null {
  for (const t of getAllNodes(tree)) {
    if (t.node.outputItemKey === itemKey) return t;
  }
  return null;
}

function tryStepScaleDownProducer(tree: TreeNode, nodeId: string): TreeNode | null {
  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  if (n.count > 1) {
    return updateNodeInTree(tree, nodeId, { count: n.count - 1 });
  }
  const maxClock = Math.max(...getMachineClocks(n));
  if (maxClock > 100) {
    return updateNodeInTree(tree, nodeId, {
      clockPercent: Math.max(100, maxClock - STORAGE_CLOCK_STEP),
    });
  }
  return null;
}

function tryStepScaleUpProducer(
  tree: TreeNode,
  nodeId: string,
  itemKey: KeyName,
  reserves: Readonly<Record<string, number>>
): TreeNode | null {
  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  const b = getEffectiveOutputPerMachine(n);
  if (b <= 0) return null;

  const fr = computeFlowRates(tree);
  const { produced, consumed } = computeFlowBalanceMaps(tree, fr);
  const target = (consumed.get(itemKey) ?? 0) + (reserves[itemKey] ?? 0);
  const sup = produced.get(itemKey) ?? 0;
  if (sup >= target - STORAGE_BALANCE_EPS) return null;

  const maxClock = Math.max(...getMachineClocks(n));
  const equivNow = getTotalClockFraction(n);
  if (maxClock > 100.5 && equivNow >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (maxClock <= 100.5) {
    const at100 = n.count * b;
    if (target > at100 + STORAGE_BALANCE_EPS) {
      return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
    }
  }

  const nextClock = Math.min(250, maxClock + STORAGE_CLOCK_STEP);
  const equivIfClock = (n.count * nextClock) / 100;
  if (nextClock > maxClock && equivIfClock >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (maxClock < 250) {
    return updateNodeInTree(tree, nodeId, { clockPercent: nextClock });
  }

  return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
}

/** Remove surplus for `itemKey` without going under downstream demand (first matching producer only). */
export function optimizeStorageItemNoWaste(tree: TreeNode, itemKey: KeyName): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  for (let i = 0; i < 100; i++) {
    const fr = computeFlowRates(t);
    const { produced, consumed } = computeFlowBalanceMaps(t, fr);
    const dem = consumed.get(itemKey) ?? 0;
    const sup = produced.get(itemKey) ?? 0;
    if (sup <= dem + STORAGE_BALANCE_EPS) break;
    const anchor = findFirstProducerForItem(t, itemKey);
    if (!anchor) break;
    const next = tryStepScaleDownProducer(t, anchor.id);
    if (!next) break;
    const t2 = recalcTree(synthesizeMissingInputEdges(next));
    const fr2 = computeFlowRates(t2);
    const { produced: p2, consumed: c2 } = computeFlowBalanceMaps(t2, fr2);
    const sup2 = p2.get(itemKey) ?? 0;
    const dem2 = c2.get(itemKey) ?? 0;
    if (sup2 < dem2 - 0.01) break;
    t = t2;
  }
  return t;
}

/** Meet downstream demand + reserve for `itemKey` (scale up first producer). */
export function satisfyStorageReserveForItem(
  tree: TreeNode,
  itemKey: KeyName,
  reserves: Readonly<Record<string, number>>
): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  for (let i = 0; i < 100; i++) {
    const fr = computeFlowRates(t);
    const { produced, consumed } = computeFlowBalanceMaps(t, fr);
    const target = (consumed.get(itemKey) ?? 0) + (reserves[itemKey] ?? 0);
    const sup = produced.get(itemKey) ?? 0;
    if (sup >= target - STORAGE_BALANCE_EPS) break;
    const anchor = findFirstProducerForItem(t, itemKey);
    if (!anchor) break;
    const next = tryStepScaleUpProducer(t, anchor.id, itemKey, reserves);
    if (!next) break;
    t = recalcTree(synthesizeMissingInputEdges(next));
  }
  return t;
}

function nodeTheoreticalMaxOutputFromFlow(
  flowRates: Map<string, FlowRateData | { parentSending: number }>,
  nodeId: string
): number {
  const fd = flowRates.get(nodeId);
  if (!fd) return 0;
  if ("maxOutput" in fd && typeof (fd as FlowRateData).maxOutput === "number") {
    return (fd as FlowRateData).maxOutput;
  }
  if ("parentSending" in fd) {
    return (fd as { parentSending: number }).parentSending;
  }
  return 0;
}

function tryStepScaleUpProducerMinOutput(tree: TreeNode, nodeId: string, minOutputRate: number): TreeNode | null {
  const fr = computeFlowRates(tree);
  const theory = nodeTheoreticalMaxOutputFromFlow(fr, nodeId);
  if (theory >= minOutputRate - STORAGE_BALANCE_EPS) return null;

  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  const b = getEffectiveOutputPerMachine(n);
  if (b <= 0) return null;

  const maxClock = Math.max(...getMachineClocks(n));
  const equivNow = getTotalClockFraction(n);
  if (maxClock > 100.5 && equivNow >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (maxClock <= 100.5) {
    const at100 = n.count * b;
    if (minOutputRate > at100 + STORAGE_BALANCE_EPS) {
      return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
    }
  }

  const nextClock = Math.min(250, maxClock + STORAGE_CLOCK_STEP);
  const equivIfClock = (n.count * nextClock) / 100;
  if (nextClock > maxClock && equivIfClock >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (maxClock < 250) {
    return updateNodeInTree(tree, nodeId, { clockPercent: nextClock });
  }

  return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
}

function depthFromRoot(tree: TreeNode, nodeId: string): number {
  let d = 0;
  let cur: TreeNode | null = findNode(tree, nodeId);
  while (cur?.parentId) {
    d += 1;
    cur = findNode(tree, cur.parentId);
  }
  return d;
}

/** `startId` plus every machine/miner reachable by following recipe inputs → {@link resolveSupplierIds}. */
function collectUpstreamClosureIds(tree: TreeNode, startId: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const n = findNode(tree, id);
    if (!n || !n.node.recipeKey || n.node.isRaw) return;
    for (const { itemKey } of getRecipeInputsPerMinute(n.node.recipeKey)) {
      for (const sid of resolveSupplierIds(tree, n, itemKey)) {
        visit(sid);
      }
    }
  }
  visit(startId);
  return order;
}

function applyBeltForConsumerInput(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  needThroughput: number,
  preferredBeltKey: string
): TreeNode {
  const consumer = findNode(tree, consumerId);
  if (!consumer) return tree;
  const beltKey = pickBeltAtLeastPreferred(needThroughput, preferredBeltKey, itemKey);
  const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
  if (parent?.node.outputItemKey === itemKey) {
    return updateChildBeltInTree(tree, parent.id, consumerId, beltKey);
  }
  const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
  if (edge) {
    return updateInputEdgeBeltInTree(tree, consumerId, itemKey, beltKey);
  }
  return tree;
}

function readConsumerInputFlow(
  tree: TreeNode,
  flowRates: Map<string, FlowRateData | { parentSending: number }>,
  consumerId: string,
  itemKey: KeyName
): { needs: number; receives: number } {
  const consumer = findNode(tree, consumerId);
  if (!consumer?.node.recipeKey) return { needs: 0, receives: 0 };
  const base = getRecipeInputsPerMinute(consumer.node.recipeKey).find((x) => x.itemKey === itemKey);
  const needsFallback = (base?.perMinute ?? 0) * getTotalClockFraction(consumer.node);
  const cfd = flowRates.get(consumerId) as FlowRateData | undefined;
  if (cfd?.inputs && cfd.inputs.length > 0) {
    const row = cfd.inputs.find((i) => i.itemKey === itemKey);
    if (row) return { needs: row.needsInput, receives: row.receivesInput };
  }
  if (cfd && "receivesInput" in cfd) {
    const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
    if (parent?.node.outputItemKey === itemKey) {
      return { needs: cfd.needsInput, receives: cfd.receivesInput };
    }
  }
  return { needs: needsFallback, receives: 0 };
}

function scaleSupplierUntilInputFed(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  supplierId: string,
  preferredBeltKey: string
): TreeNode {
  let t = tree;
  for (let g = 0; g < 140; g++) {
    t = recalcTree(synthesizeMissingInputEdges(t));
    const consumer = findNode(t, consumerId);
    if (!consumer?.node.recipeKey) break;
    const base = getRecipeInputsPerMinute(consumer.node.recipeKey).find((x) => x.itemKey === itemKey);
    if (!base) break;
    const needThroughput = base.perMinute * getTotalClockFraction(consumer.node);
    t = applyBeltForConsumerInput(t, consumerId, itemKey, needThroughput, preferredBeltKey);
    t = recalcTree(synthesizeMissingInputEdges(t));

    const fr = computeFlowRates(t);
    const { needs, receives } = readConsumerInputFlow(t, fr, consumerId, itemKey);
    if (needs <= 0) break;
    if (receives >= needs - STORAGE_BALANCE_EPS) break;

    const supplierTheory = nodeTheoreticalMaxOutputFromFlow(fr, supplierId);
    if (supplierTheory >= needs - STORAGE_BALANCE_EPS) break;

    const stepped = tryStepScaleUpProducerMinOutput(t, supplierId, needs);
    if (!stepped) break;
    t = stepped;
  }
  return t;
}

function autoBalanceAllInputsForNode(tree: TreeNode, consumerId: string, preferredBeltKey: string): TreeNode {
  let t = tree;
  const consumer = findNode(t, consumerId);
  if (!consumer || consumer.node.isRaw || !consumer.node.recipeKey) return t;

  for (const { itemKey, perMinute } of getRecipeInputsPerMinute(consumer.node.recipeKey)) {
    if (perMinute <= 0) continue;
    const needThroughput = perMinute * getTotalClockFraction(consumer.node);
    const suppliers = resolveSupplierIds(t, consumer, itemKey);
    if (suppliers.length === 0) continue;

    const parent = consumer.parentId ? findNode(t, consumer.parentId) : null;
    const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
    const primary = parent?.node.outputItemKey === itemKey ? parent.id : edge?.producerId;
    const orderedSuppliers = primary
      ? [primary, ...suppliers.filter((id) => id !== primary)]
      : suppliers;

    t = applyBeltForConsumerInput(t, consumerId, itemKey, needThroughput, preferredBeltKey);

    for (const supplierId of orderedSuppliers) {
      t = scaleSupplierUntilInputFed(t, consumerId, itemKey, supplierId, preferredBeltKey);
      t = recalcTree(synthesizeMissingInputEdges(t));
      const fr = computeFlowRates(t);
      const { needs, receives } = readConsumerInputFlow(t, fr, consumerId, itemKey);
      if (needs > 0 && receives >= needs - STORAGE_BALANCE_EPS) break;
    }
  }
  return t;
}

/**
 * Auto-balance after an edit: walk the upstream closure from `startNodeId` (recipe consumers only), shallow→deep,
 * repeatedly satisfying every input via {@link resolveSupplierIds} (not only tree parent). Fixes multi-input machines
 * (e.g. Encased Industrial Beam: steel beam + concrete from edges / other slices).
 */
export function autoBalanceAfterEdit(
  tree: TreeNode,
  startNodeId: string,
  preferredBeltKey: string
): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  const closure = collectUpstreamClosureIds(t, startNodeId);
  const consumerIds = closure.filter((id) => {
    const n = findNode(t, id);
    return Boolean(n && !n.node.isRaw && n.node.recipeKey);
  });
  consumerIds.sort((a, b) => depthFromRoot(t, a) - depthFromRoot(t, b));

  for (let round = 0; round < 10; round++) {
    t = recalcTree(synthesizeMissingInputEdges(t));
    for (const cid of consumerIds) {
      t = autoBalanceAllInputsForNode(t, cid, preferredBeltKey);
    }
  }
  return recalcTree(synthesizeMissingInputEdges(t));
}

/** @deprecated Use {@link autoBalanceAfterEdit}; kept name for call sites. */
export function autoBalanceAncestorChain(
  tree: TreeNode,
  leafId: string,
  preferredBeltKey: string
): TreeNode {
  return autoBalanceAfterEdit(tree, leafId, preferredBeltKey);
}
