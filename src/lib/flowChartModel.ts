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
  /** When length matches `count`, each entry is that machine's clock % (1–250). Otherwise all use `clockPercent`. */
  machineClockPercents?: number[];
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

/** Power shards slotted for overclock: 101–150% → 1, 151–200% → 2, 201–250% → 3 per machine. */
export function powerShardsForClockPercent(clockPercent: number): number {
  if (clockPercent <= 100) return 0;
  if (clockPercent <= 150) return 1;
  if (clockPercent <= 200) return 2;
  return 3;
}

/** Resolved clock % for each physical machine (uniform from `clockPercent` when no per-machine array). */
export function getMachineClocks(node: FlowNode): number[] {
  const { count, clockPercent, machineClockPercents } = node;
  if (count <= 0) return [];
  if (machineClockPercents?.length === count) {
    return machineClockPercents.map((c) => Math.min(250, Math.max(1, Math.round(c))));
  }
  return Array.from({ length: count }, () => Math.min(250, Math.max(1, Math.round(clockPercent))));
}

/** Sum of (clock%/100) across machines — multiplies recipe rates and output the same as uniform (clock/100)×count when all equal. */
export function getTotalClockFraction(node: FlowNode): number {
  return getMachineClocks(node).reduce((sum, c) => sum + c / 100, 0);
}

/** Integer average clock for the shared slider / summary. */
export function getAverageClockPercent(node: FlowNode): number {
  const clocks = getMachineClocks(node);
  if (clocks.length === 0) return node.clockPercent;
  return Math.round(clocks.reduce((a, b) => a + b, 0) / clocks.length);
}

export function totalPowerShardsForNode(node: FlowNode): number {
  return getMachineClocks(node).reduce((s, c) => s + powerShardsForClockPercent(c), 0);
}
