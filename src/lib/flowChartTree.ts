/**
 * Tree navigation, horizontal slice layout, sibling reorder, and flow-hover relations.
 * Kept out of FlowChart.tsx for easier testing and navigation.
 */

import { getRecipeInputsPerMinute } from "@/lib/chain";
import type { TreeNode } from "@/lib/flowChartModel";
import type { KeyName } from "@/lib/types";

export function findNode(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function replaceNode(tree: TreeNode, nodeId: string, replacer: (t: TreeNode) => TreeNode): TreeNode {
  if (tree.id === nodeId) return replacer(tree);
  return {
    ...tree,
    children: tree.children.map((c) => replaceNode(c, nodeId, replacer)),
  };
}

/**
 * Horizontal flow columns (same grouping as slice UI): machines at the same “stage”
 * appear together even when they’re not in each other’s parent/child chain.
 */
export function getFlowSlices(t: TreeNode): TreeNode[][] {
  if (!t.node.outputItemKey) return [];
  const result: TreeNode[][] = [];
  const rawChildren = t.children.filter((c) => c.node.isRaw);
  const consumerChildren = t.children.filter((c) => !c.node.isRaw);
  const level0 = [t, ...rawChildren];
  let level: TreeNode[] = level0;
  let nextLevel: TreeNode[] = [
    ...consumerChildren,
    ...rawChildren.flatMap((c) => c.children),
  ];
  while (level.length > 0) {
    result.push(level);
    level = nextLevel;
    nextLevel = level.flatMap((n) => n.children);
  }
  return result;
}

/**
 * Cluster nodes in one horizontal slice by `parentId` so sibling stacks can be centered as branch groups.
 * Parent bucket order follows first appearance in `sliceNodes`.
 */
export function groupSliceNodesByParent(
  sliceNodes: TreeNode[]
): { parentId: string | null; nodes: TreeNode[] }[] {
  const order: (string | null)[] = [];
  const byParent = new Map<string | null, TreeNode[]>();
  for (const n of sliceNodes) {
    const p = n.parentId;
    if (!byParent.has(p)) {
      byParent.set(p, []);
      order.push(p);
    }
    byParent.get(p)!.push(n);
  }
  return order.map((parentId) => ({ parentId, nodes: byParent.get(parentId)! }));
}

/**
 * Who supplies `itemKey` to this consumer: tree parent, explicit input edge, or (fallback)
 * nodes that output that item in the same horizontal slice **before** this node (pool order),
 * plus any producers in the nearest earlier slice (matches horizontal slice pool order in the flow sim).
 */
export function resolveSupplierIds(tree: TreeNode, consumer: TreeNode, itemKey: KeyName): string[] {
  const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
  if (parent?.node.outputItemKey === itemKey) {
    return [parent.id];
  }

  const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
  if (edge) {
    return [edge.producerId];
  }

  const slices = getFlowSlices(tree);
  const consumerSlice = slices.findIndex((sl) => sl.some((n) => n.id === consumer.id));
  if (consumerSlice < 0) return [];

  const found: string[] = [];
  const sl = slices[consumerSlice]!;
  const consumerIdx = sl.findIndex((n) => n.id === consumer.id);
  if (consumerIdx > 0) {
    for (let i = 0; i < consumerIdx; i++) {
      const n = sl[i]!;
      if (n.node.outputItemKey === itemKey) found.push(n.id);
    }
  }

  if (consumerSlice > 0) {
    for (let s = consumerSlice - 1; s >= 0; s--) {
      const sliceFound: string[] = [];
      for (const n of slices[s]!) {
        if (n.node.outputItemKey === itemKey) sliceFound.push(n.id);
      }
      if (sliceFound.length > 0) {
        found.push(...sliceFound);
        break;
      }
    }
  }

  return [...new Set(found)];
}

/** Move `activeId` among `parentId`'s children to sit before `insertBeforeId` (or end if null). */
export function reorderSiblingBefore(
  tree: TreeNode,
  parentId: string,
  activeId: string,
  insertBeforeId: string | null
): TreeNode {
  if (insertBeforeId === activeId) return tree;
  return replaceNode(tree, parentId, (parent) => {
    const ch = [...parent.children];
    const from = ch.findIndex((c) => c.id === activeId);
    if (from < 0) return parent;
    const [item] = ch.splice(from, 1);
    if (insertBeforeId === null) {
      ch.push(item);
    } else {
      const to = ch.findIndex((c) => c.id === insertBeforeId);
      if (to < 0) ch.push(item);
      else ch.splice(to, 0, item);
    }
    const same =
      ch.length === parent.children.length &&
      ch.every((c, i) => c.id === parent.children[i]?.id);
    if (same) return parent;
    return { ...parent, children: ch };
  });
}

export const EMPTY_FLOW_RELATED_IDS = new Set<string>();

/** Transitive upstream: every machine (and miner) needed to produce the hovered node's inputs. */
function collectUpstreamSupplyIds(tree: TreeNode, nodeId: string, into: Set<string>) {
  const node = findNode(tree, nodeId);
  if (!node) return;

  if (node.node.isRaw || !node.node.recipeKey) {
    return;
  }

  for (const { itemKey } of getRecipeInputsPerMinute(node.node.recipeKey)) {
    for (const sid of resolveSupplierIds(tree, node, itemKey)) {
      if (sid === nodeId) continue;
      if (!into.has(sid)) {
        into.add(sid);
        collectUpstreamSupplyIds(tree, sid, into);
      }
    }
  }
}

/**
 * All nodes that supply the hovered machine (transitive recipe closure). Excludes `nodeId`.
 */
export function getRelatedNodeIdsForHover(tree: TreeNode, nodeId: string): Set<string> {
  if (!findNode(tree, nodeId)) return EMPTY_FLOW_RELATED_IDS;
  const ids = new Set<string>();
  collectUpstreamSupplyIds(tree, nodeId, ids);
  return ids;
}
