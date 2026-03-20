/**
 * Shared flow chart node types and factories (used by FlowChart and plannerToTree).
 */

import type { KeyName } from "./types";
import { getItemDisplayName } from "./itemDisplayName";

export type NodePurity = "impure" | "normal" | "pure";

export const PURITY_MULTIPLIER: Record<NodePurity, number> = {
  impure: 0.5,
  normal: 1,
  pure: 2,
};

export function flowItemName(key: string): string {
  return getItemDisplayName(key, "comfortable");
}

export interface FlowNode {
  id: string;
  outputItemKey: KeyName;
  outputItemName: string;
  buildingKey: string;
  buildingName: string;
  recipeKey?: string;
  recipeName?: string;
  outputPerMachine: number;
  inputPerMachine?: number;
  count: number;
  clockPercent: number;
  totalOutput: number;
  isRaw: boolean;
  nodePurity?: NodePurity;
}

export interface InputEdge {
  itemKey: KeyName;
  producerId: string;
  beltKey: string;
}

export interface TreeNode {
  id: string;
  node: FlowNode;
  children: TreeNode[];
  parentId: string | null;
  incomingBeltKey?: string;
  inputEdges?: InputEdge[];
}

export function createFlowNode(
  outputItemKey: KeyName,
  buildingKey: string,
  buildingName: string,
  outputPerMachine: number,
  count: number,
  clockPercent: number,
  options: {
    recipeKey?: string;
    recipeName?: string;
    inputPerMachine?: number;
    isRaw?: boolean;
    nodePurity?: NodePurity;
  }
): FlowNode {
  const purityMult = PURITY_MULTIPLIER[options.nodePurity ?? "normal"];
  const effectiveRate = outputPerMachine * purityMult * (clockPercent / 100) * count;
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    outputItemKey,
    outputItemName: flowItemName(outputItemKey),
    buildingKey,
    buildingName,
    recipeKey: options.recipeKey,
    recipeName: options.recipeName,
    outputPerMachine,
    inputPerMachine: options.inputPerMachine,
    count,
    clockPercent,
    totalOutput: effectiveRate,
    isRaw: options.isRaw ?? false,
    nodePurity: options.nodePurity ?? "normal",
  };
}

export function createTreeNode(
  node: FlowNode,
  parentId: string | null,
  children: TreeNode[] = [],
  incomingBeltKey = "belt1"
): TreeNode {
  return { id: node.id, node, children, parentId, incomingBeltKey };
}

export function getEffectiveOutputPerMachine(node: FlowNode): number {
  const mult = node.isRaw ? PURITY_MULTIPLIER[node.nodePurity ?? "normal"] : 1;
  return node.outputPerMachine * mult;
}
