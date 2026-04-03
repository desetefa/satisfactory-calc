import { getRecipeInputsPerMinute } from "@/lib/chain";
import {
  createTreeNode,
  getEffectiveOutputPerMachine,
  getMachineClocks,
  getTotalClockFraction,
  type FlowNode,
  type InputEdge,
  type TreeNode,
} from "@/lib/flowChartModel";
import type { KeyName } from "@/lib/types";
import { findNode, replaceNode, resolveSupplierIds } from "@/lib/flowChartTree";
import { pickDefaultBelt } from "@/lib/flowChartPickBelt";
import { isFluidItem, normalizeTransportForItem } from "@/lib/flowTransport";

/**
 * Add missing {@link InputEdge} rows so each recipe input is either from the tree parent or has an edge.
 * {@link resolveSupplierIds} includes same-slice suppliers (earlier in the slice) and previous slices, so
 * pool-fed inputs get a {@link InputEdge} with {@link InputEdge.beltKey} and belt limits apply in the sim.
 */
export function synthesizeMissingInputEdges(tree: TreeNode): TreeNode {
  let out = tree;

  function visit(t: TreeNode) {
    for (const c of t.children) {
      visit(c);
    }
    if (!t.node.recipeKey || t.node.isRaw) return;

    const parent = t.parentId ? findNode(out, t.parentId) : null;
    const existingKeys = new Set((t.inputEdges ?? []).map((e) => e.itemKey));
    const newEdges: InputEdge[] = [];

    for (const { itemKey, perMinute } of getRecipeInputsPerMinute(t.node.recipeKey)) {
      if (existingKeys.has(itemKey)) continue;
      if (parent?.node.outputItemKey === itemKey) continue;

      const suppliers = resolveSupplierIds(out, t, itemKey);
      if (suppliers.length === 0) continue;

      const edge: InputEdge = {
        itemKey,
        producerId: suppliers[0]!,
        beltKey: pickDefaultBelt(perMinute * getTotalClockFraction(t.node), itemKey),
      };
      newEdges.push(edge);
      existingKeys.add(itemKey);
    }

    if (newEdges.length > 0) {
      out = replaceNode(out, t.id, (tn) => ({
        ...tn,
        inputEdges: [...(tn.inputEdges ?? []), ...newEdges],
      }));
    }
  }

  visit(tree);
  return out;
}

export function updateChildBeltInTree(
  tree: TreeNode,
  parentId: string,
  childId: string,
  incomingBeltKey: string
): TreeNode {
  return replaceNode(tree, parentId, (t) => ({
    ...t,
    children: t.children.map((c) => (c.id === childId ? { ...c, incomingBeltKey } : c)),
  }));
}

export function updateInputEdgeBeltInTree(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  beltKey: string
): TreeNode {
  return replaceNode(tree, consumerId, (t) => {
    if (!t.inputEdges) return t;
    return {
      ...t,
      inputEdges: t.inputEdges.map((e) => (e.itemKey === itemKey ? { ...e, beltKey } : e)),
    };
  });
}

export function updateNodeInTree(tree: TreeNode, nodeId: string, updates: Partial<FlowNode>): TreeNode {
  return replaceNode(tree, nodeId, (t) => {
    const prev = t.node;
    const merged = { ...prev, ...updates };
    const node = merged;

    if (updates.machineClockPercents !== undefined) {
      const mcp = updates.machineClockPercents;
      if (mcp.length === merged.count) {
        node.machineClockPercents = mcp;
        node.clockPercent = Math.round(mcp.reduce((a, b) => a + b, 0) / mcp.length);
      }
    } else if (updates.clockPercent !== undefined) {
      node.machineClockPercents = undefined;
    }

    if (
      updates.count !== undefined &&
      updates.machineClockPercents === undefined &&
      updates.clockPercent === undefined
    ) {
      if (prev.machineClockPercents?.length === prev.count) {
        let arr = [...prev.machineClockPercents];
        if (merged.count > prev.count) {
          const fill = prev.clockPercent;
          while (arr.length < merged.count) arr.push(fill);
        } else {
          arr = arr.slice(0, merged.count);
        }
        node.machineClockPercents = arr;
        node.clockPercent = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      } else {
        node.machineClockPercents = undefined;
      }
    }

    if (
      updates.count !== undefined ||
      updates.clockPercent !== undefined ||
      updates.machineClockPercents !== undefined ||
      updates.outputPerMachine !== undefined ||
      updates.nodePurity !== undefined
    ) {
      node.totalOutput = getEffectiveOutputPerMachine(node) * getTotalClockFraction(node);
    }

    return { ...t, node };
  });
}

export function addChildToNode(
  tree: TreeNode,
  parentId: string,
  newNode: FlowNode,
  prepend: boolean | number = false,
  inputEdges?: InputEdge[],
  /** When set, the new child appears in this horizontal slice column (must match UI column where it was added). */
  displaySliceIndex?: number
): TreeNode {
  const parent = findNode(tree, parentId);
  const throughput = (newNode.inputPerMachine ?? 0) * newNode.count;
  const connectionItemKey = parent?.node.outputItemKey;
  const beltKey = pickDefaultBelt(throughput, connectionItemKey);
  const base = createTreeNode(newNode, parentId, [], beltKey);
  const newChild: TreeNode = {
    ...base,
    inputEdges,
    ...(displaySliceIndex !== undefined ? { displaySliceIndex } : {}),
  };
  return replaceNode(tree, parentId, (t) => {
    const insertIdx =
      prepend === true
        ? 0
        : typeof prepend === "number"
          ? Math.max(0, Math.min(prepend, t.children.length))
          : t.children.length;
    const next = [...t.children];
    next.splice(insertIdx, 0, newChild);
    return { ...t, children: next };
  });
}

/** Merge two siblings that produce the same output: combine counts into left, remove right. Move right's children to left. */
export function mergeNodesAsChild(
  tree: TreeNode,
  parentId: string,
  leftId: string,
  rightId: string
): TreeNode {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;
  const leftIdx = parent.children.findIndex((c) => c.id === leftId);
  const rightIdx = parent.children.findIndex((c) => c.id === rightId);
  if (leftIdx < 0 || rightIdx < 0 || leftIdx >= rightIdx) return tree;
  const left = parent.children[leftIdx];
  const right = parent.children[rightIdx];
  if (left.node.outputItemKey !== right.node.outputItemKey) return tree;
  const combinedCount = left.node.count + right.node.count;
  const lc = getMachineClocks(left.node);
  const rc = getMachineClocks(right.node);
  const mergedClocks = [...lc, ...rc];
  const mergedAvg = Math.round(mergedClocks.reduce((a, b) => a + b, 0) / mergedClocks.length);
  let updated = replaceNode(tree, leftId, (l) => ({
    ...l,
    node: {
      ...l.node,
      count: combinedCount,
      machineClockPercents: mergedClocks,
      clockPercent: mergedAvg,
      totalOutput: getEffectiveOutputPerMachine(l.node) * mergedClocks.reduce((s, c) => s + c / 100, 0),
    },
    children: [...l.children, ...right.children.map((c) => ({ ...c, parentId: leftId }))],
  }));
  updated = replaceNode(updated, parentId, (p) => ({
    ...p,
    children: p.children.filter((c) => c.id !== rightId),
  }));
  return updated;
}

/**
 * Merge two nodes that produce the same item but may live under **different** parents.
 * Left node survives; right node's machine count is added to left, right's children are
 * re-parented to left, and right is removed from its parent's children list.
 *
 * Falls back to {@link mergeNodesAsChild} when both nodes share the same parent.
 */
export function mergeNodesAcrossParents(
  tree: TreeNode,
  leftId: string,
  rightId: string
): TreeNode {
  const left = findNode(tree, leftId);
  const right = findNode(tree, rightId);
  if (!left || !right) return tree;
  if (left.node.outputItemKey !== right.node.outputItemKey) return tree;

  if (left.parentId !== null && left.parentId === right.parentId) {
    return mergeNodesAsChild(tree, left.parentId, leftId, rightId);
  }

  const lc = getMachineClocks(left.node);
  const rc = getMachineClocks(right.node);
  const mergedClocks = [...lc, ...rc];
  const mergedAvg = Math.round(mergedClocks.reduce((a, b) => a + b, 0) / mergedClocks.length);

  let updated = replaceNode(tree, leftId, (l) => ({
    ...l,
    node: {
      ...l.node,
      count: l.node.count + right.node.count,
      machineClockPercents: mergedClocks,
      clockPercent: mergedAvg,
      totalOutput: getEffectiveOutputPerMachine(l.node) * mergedClocks.reduce((s, c) => s + c / 100, 0),
    },
    children: [...l.children, ...right.children.map((c) => ({ ...c, parentId: leftId }))],
  }));

  // Remove right from its parent (or from tree root children if parentId is null).
  const rightParentId = right.parentId ?? tree.id;
  updated = replaceNode(updated, rightParentId, (p) => ({
    ...p,
    children: p.children.filter((c) => c.id !== rightId),
  }));

  return updated;
}

/** Split a merged node (count > 1) into two siblings. Children stay with the first (count 1). */
export function splitMergedNode(tree: TreeNode, parentId: string, nodeId: string): TreeNode {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;
  const node = parent.children.find((c) => c.id === nodeId);
  if (!node || node.node.count < 2) return tree;
  const leftCount = 1;
  const rightCount = node.node.count - 1;
  const splitClocks = getMachineClocks(node.node);
  const leftClocks = splitClocks.slice(0, 1);
  const rightClocks = splitClocks.slice(1);
  const leftNode = {
    ...node.node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    count: leftCount,
    machineClockPercents: leftClocks.length === leftCount ? leftClocks : undefined,
    clockPercent: leftClocks[0] ?? node.node.clockPercent,
    totalOutput: getEffectiveOutputPerMachine(node.node) * (leftClocks[0]! / 100),
  };
  const rightNode = {
    ...node.node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-r`,
    count: rightCount,
    machineClockPercents: rightClocks.length === rightCount ? rightClocks : undefined,
    clockPercent:
      rightClocks.length > 0
        ? Math.round(rightClocks.reduce((a, b) => a + b, 0) / rightClocks.length)
        : node.node.clockPercent,
    totalOutput:
      getEffectiveOutputPerMachine(node.node) * rightClocks.reduce((s, c) => s + c / 100, 0),
  };
  const throughput = (rightNode.inputPerMachine ?? 0) * rightCount;
  const connectionItemKey = parent.node.outputItemKey;
  const leftChild = createTreeNode(leftNode, parentId, node.children, node.incomingBeltKey);
  const rightChild = createTreeNode(rightNode, parentId, [], pickDefaultBelt(throughput, connectionItemKey));
  const newChildren = parent.children.flatMap((c) => (c.id === nodeId ? [leftChild, rightChild] : [c]));
  return replaceNode(tree, parentId, (p) => ({
    ...p,
    children: newChildren,
  }));
}

/**
 * Break a single machine at `machineIndex` out of the node into a new standalone sibling.
 * The remaining (count-1) machines keep the original node's children; the broken-out
 * machine is a new sibling with no children and its own clock.
 */
export function breakOutMachine(
  tree: TreeNode,
  parentId: string,
  nodeId: string,
  machineIndex: number
): TreeNode {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;
  const node = parent.children.find((c) => c.id === nodeId);
  if (!node || node.node.count < 2) return tree;

  const clocks = getMachineClocks(node.node);
  const brokenClock = clocks[machineIndex] ?? node.node.clockPercent;
  const remainingClocks = clocks.filter((_, i) => i !== machineIndex);
  const remainingCount = node.node.count - 1;
  const avgRemainingClock =
    remainingClocks.length > 0
      ? Math.round(remainingClocks.reduce((a, b) => a + b, 0) / remainingClocks.length)
      : node.node.clockPercent;

  const remainingNode: FlowNode = {
    ...node.node,
    count: remainingCount,
    machineClockPercents: remainingClocks.length === remainingCount ? remainingClocks : undefined,
    clockPercent: avgRemainingClock,
    totalOutput:
      getEffectiveOutputPerMachine(node.node) *
      remainingClocks.reduce((s, c) => s + c / 100, 0),
  };

  const brokenNode: FlowNode = {
    ...node.node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-b`,
    count: 1,
    clockPercent: brokenClock,
    machineClockPercents: undefined,
    totalOutput: getEffectiveOutputPerMachine(node.node) * (brokenClock / 100),
  };

  const throughput = (brokenNode.inputPerMachine ?? 0) * 1;
  const connectionItemKey = parent.node.outputItemKey;
  const remainingChild = createTreeNode(remainingNode, parentId, node.children, node.incomingBeltKey);
  const brokenChild = createTreeNode(brokenNode, parentId, [], pickDefaultBelt(throughput, connectionItemKey));

  const newChildren = parent.children.flatMap((c) =>
    c.id === nodeId ? [remainingChild, brokenChild] : [c]
  );
  return replaceNode(tree, parentId, (p) => ({ ...p, children: newChildren }));
}

/** Replace every belt in the tree (incomingBeltKey + inputEdges) with `beltKey`. */
export function updateAllBeltsInTree(tree: TreeNode, beltKey: string): TreeNode {
  function walk(node: TreeNode, isRoot: boolean, parentOutputItemKey?: KeyName): TreeNode {
    return {
      ...node,
      incomingBeltKey: isRoot
        ? node.incomingBeltKey
        : parentOutputItemKey && isFluidItem(parentOutputItemKey)
          ? normalizeTransportForItem(parentOutputItemKey, node.incomingBeltKey)
          : beltKey,
      inputEdges: node.inputEdges?.map((e) => ({
        ...e,
        beltKey: isFluidItem(e.itemKey) ? normalizeTransportForItem(e.itemKey, e.beltKey) : beltKey,
      })),
      children: node.children.map((c) => walk(c, false, node.node.outputItemKey)),
    };
  }
  return walk(tree, true);
}

export function recalcTree(tree: TreeNode): TreeNode {
  function recalc(t: TreeNode): TreeNode {
    const recalcChildren = t.children.map(recalc);
    const node = { ...t.node };

    if (t.children.length === 0) {
      node.totalOutput = getEffectiveOutputPerMachine(node) * getTotalClockFraction(node);
      return { ...t, node, children: [] };
    }

    node.totalOutput = getEffectiveOutputPerMachine(node) * getTotalClockFraction(node);

    return { ...t, node, children: recalcChildren };
  }
  return recalc(tree);
}
