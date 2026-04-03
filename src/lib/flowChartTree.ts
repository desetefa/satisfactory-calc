/**
 * Tree navigation, horizontal slice layout, sibling reorder, and flow-hover relations.
 * Kept out of FlowChart.tsx for easier testing and navigation.
 */

import { getRecipeInputsPerMinute } from "@/lib/chain";
import { getRecipe, recipePerMinute } from "@/lib/db";
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

/** Maps each node id to its parent's id from actual tree links (`null` = root). */
function buildParentIdMap(tree: TreeNode): Map<string, string | null> {
  const m = new Map<string, string | null>();
  function walk(t: TreeNode, parentId: string | null) {
    m.set(t.id, parentId);
    for (const c of t.children) walk(c, t.id);
  }
  walk(tree, null);
  return m;
}

function parentBucketKeyFromTree(parentMap: Map<string, string | null>, n: TreeNode): string | null {
  const fromTree = parentMap.get(n.id);
  if (fromTree !== undefined) return fromTree;
  const raw = n.parentId;
  if (raw == null || raw === "") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  return typeof raw === "string" ? raw.trim() : null;
}

function sortNodesBySiblingsUnderParent(
  tree: TreeNode,
  parentKey: string | null,
  nodes: TreeNode[]
): TreeNode[] {
  if (parentKey == null) {
    return [...nodes];
  }
  const p = findNode(tree, parentKey);
  if (!p) return [...nodes];
  const idx = new Map(p.children.map((c, i) => [c.id, i]));
  return [...nodes].sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
}

/**
 * Cluster nodes in one horizontal slice by **actual tree parent** (walked from `tree`), not only each
 * node's `parentId` field. Stale or inconsistent `parentId` after moves would otherwise split one branch into
 * duplicate stacks (duplicate + chrome above/below each machine).
 * Parent bucket order follows first appearance in `sliceNodes`.
 */
export function groupSliceNodesByParent(
  tree: TreeNode,
  sliceNodes: TreeNode[]
): { parentId: string | null; nodes: TreeNode[] }[] {
  const parentMap = buildParentIdMap(tree);
  const order: (string | null)[] = [];
  const byParent = new Map<string | null, TreeNode[]>();
  for (const n of sliceNodes) {
    const p = parentBucketKeyFromTree(parentMap, n);
    if (!byParent.has(p)) {
      byParent.set(p, []);
      order.push(p);
    }
    byParent.get(p)!.push(n);
  }
  return order.map((parentId) => ({
    parentId,
    nodes: sortNodesBySiblingsUnderParent(tree, parentId, byParent.get(parentId)!),
  }));
}

function flattenTreeNodes(tree: TreeNode): TreeNode[] {
  return [tree, ...tree.children.flatMap((c) => flattenTreeNodes(c))];
}

/** Default display column index per node from tree depth (matches {@link getFlowSlices} ordering). */
export function getDefaultDisplaySliceIndexMap(tree: TreeNode): Map<string, number> {
  const m = new Map<string, number>();
  const slices = getFlowSlices(tree);
  slices.forEach((nodes, sliceIdx) => {
    for (const n of nodes) {
      m.set(n.id, sliceIdx);
    }
  });
  return m;
}

/** Slice columns for the horizontal UI (display only; flow sim uses tree depth via getFlowSlices). */
export function getDisplaySlices(tree: TreeNode): TreeNode[][] {
  if (!tree.node.outputItemKey) return [];
  const defaultMap = getDefaultDisplaySliceIndexMap(tree);
  const all = flattenTreeNodes(tree);
  let maxIdx = 0;
  for (const n of all) {
    const def = defaultMap.get(n.id) ?? 0;
    const idx = n.displaySliceIndex ?? def;
    maxIdx = Math.max(maxIdx, idx, def);
  }
  const preorder = flattenTreeNodes(tree);
  const rank = new Map<string, number>();
  preorder.forEach((n, i) => rank.set(n.id, i));

  const out: TreeNode[][] = [];
  for (let s = 0; s <= maxIdx; s++) {
    const inSlice = all.filter((n) => {
      const def = defaultMap.get(n.id) ?? 0;
      const idx = n.displaySliceIndex ?? def;
      return idx === s;
    });
    inSlice.sort((a, b) => {
      const pa = a.displayColumnPosition ?? Number.MAX_SAFE_INTEGER;
      const pb = b.displayColumnPosition ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    });
    out.push(inSlice);
  }
  return out;
}

/**
 * When one sibling is dropped in a display column, keep the whole sibling stack in that column.
 * Otherwise mixed explicit `displaySliceIndex` vs flow-default leaves machines in different columns
 * (double + chrome between columns, vertical reorder broken).
 */
/** Set display column and sibling order (children array) under `parentId`. Flow math unchanged. */
export function moveNodeDisplaySlice(
  tree: TreeNode,
  parentId: string,
  activeId: string,
  targetSliceIdx: number,
  insertBeforeId: string | null
): TreeNode {
  const safeSlice = Math.max(0, Math.floor(targetSliceIdx));
  // Root node has no parent — just update its displaySliceIndex directly.
  if (activeId === tree.id) {
    return replaceNode(tree, activeId, (n) => ({ ...n, displaySliceIndex: safeSlice }));
  }
  /**
   * Structural parent from the tree walk — source of truth. The UI passes `parentId` from branch
   * metadata; if that drifted from `parent.children`, reorder would no-op and pin would skip the active
   * node while `node.parentId` was overwritten, leaving siblings split across columns.
   */
  const parentMap = buildParentIdMap(tree);
  const structuralParentId = parentMap.get(activeId);
  let effectiveParentId: string | null = null;
  if (structuralParentId === undefined) {
    const p = findNode(tree, parentId);
    if (p?.children.some((c) => c.id === activeId)) effectiveParentId = parentId;
    else return tree;
  } else if (structuralParentId === null) {
    return tree;
  } else {
    effectiveParentId = structuralParentId;
  }

  let t = replaceNode(tree, activeId, (n) => ({
    ...n,
    displaySliceIndex: safeSlice,
  }));
  t = reorderSiblingBefore(t, effectiveParentId, activeId, insertBeforeId);
  return t;
}

/**
 * Who supplies `itemKey` to this consumer: tree parent, explicit input edge, or (fallback)
 * any node in the same horizontal slice that outputs that item (sibling / same-column supply),
 * plus any producers in the nearest earlier slice. Flow sim uses topologically sorted slice order so
 * producers run before consumers regardless of sibling order.
 */
export function resolveSupplierIds(tree: TreeNode, consumer: TreeNode, itemKey: KeyName): string[] {
  const nodeProducesItem = (node: TreeNode, key: KeyName): boolean => {
    if (node.node.outputItemKey === key) return true;
    if (!node.node.recipeKey || node.node.isRaw) return false;
    const recipe = getRecipe(node.node.recipeKey);
    if (!recipe) return false;
    return recipePerMinute(recipe).products.some(([productKey]) => productKey === key);
  };

  const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
  if (parent && nodeProducesItem(parent, itemKey)) {
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
  for (const n of sl) {
    if (n.id === consumer.id) continue;
    if (nodeProducesItem(n, itemKey)) found.push(n.id);
  }

  if (consumerSlice > 0) {
    for (let s = consumerSlice - 1; s >= 0; s--) {
      const sliceFound: string[] = [];
      for (const n of slices[s]!) {
        if (nodeProducesItem(n, itemKey)) sliceFound.push(n.id);
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

/**
 * Assign `displayColumnPosition` values to every node in `currentColumnOrder` after moving
 * `activeId` before `insertBeforeId` (or to end if null). This controls visual order within a
 * display column independently of tree parent/child structure ("floors" model).
 */
export function reorderNodeInColumn(
  tree: TreeNode,
  activeId: string,
  insertBeforeId: string | null,
  currentColumnOrder: string[]
): TreeNode {
  if (currentColumnOrder.length === 0) return tree;
  const rest = currentColumnOrder.filter((id) => id !== activeId);
  let newOrder: string[];
  if (insertBeforeId === null) {
    newOrder = [...rest, activeId];
  } else {
    const to = rest.indexOf(insertBeforeId);
    if (to < 0) {
      newOrder = [...rest, activeId];
    } else {
      const arr = [...rest];
      arr.splice(to, 0, activeId);
      newOrder = arr;
    }
  }
  let t = tree;
  newOrder.forEach((id, position) => {
    t = replaceNode(t, id, (n) => ({ ...n, displayColumnPosition: position }));
  });
  return t;
}
