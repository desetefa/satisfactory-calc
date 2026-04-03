import type { FlowNode, InputEdge, TreeNode } from "@/lib/flowChartModel";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import type { KeyName } from "@/lib/types";
import type { MachineOption } from "@/components/flow-chart/flowChartTypes";

/** A single item flowing in from another factory (for the slice 0 INPUT header). */
export interface FactoryImportRow {
  itemKey: KeyName;
  ratePerMin: number;
  fromFactoryName: string;
}

export interface TreeLevelProps {
  treeNode: TreeNode;
  tree: TreeNode;
  flowRates: Map<string, FlowRateData | { parentSending: number }>;
  machineOptions: MachineOption[];
  parentOutputItemKey?: KeyName;
  onUpdateNode: (nodeId: string, u: Partial<FlowNode>) => void;
  onSelectNodeMachine: (nodeId: string, opt: MachineOption) => void;
  onAddMachine: (
    parent: TreeNode,
    option: MachineOption,
    insertAtIndex?: number,
    inputEdges?: InputEdge[],
    /** Horizontal slice column for the new machine (TreeLevelSlices only). */
    displaySliceIndex?: number
  ) => void;
  onUpdateChildBelt: (parentId: string, childId: string, incomingBeltKey: string) => void;
  onUpdateInputEdgeBelt?: (consumerId: string, itemKey: KeyName, beltKey: string) => void;
  onMergeNodes?: (parentId: string, leftId: string, rightId: string) => void;
  /** Merge two nodes with potentially different parents (cross-branch merge). */
  onMergeCrossParent?: (leftId: string, rightId: string) => void;
  onSplitNode?: (parentId: string, nodeId: string) => void;
  onBreakOutMachine?: (parentId: string, nodeId: string, machineIndex: number) => void;
  parentId?: string | null;
  incomingBeltKey?: string;
  onUpdateBelt?: (beltKey: string) => void;
  onRemove?: () => void;
  removeNode: (parentId: string | null, nodeId: string) => void;
  onSetSeparateAction?: (action: (() => void) | null) => void;
  compactSlice?: boolean;
  /** Focus node for upstream highlight (pinned click locks until unpinned; hover only when unpinned) */
  flowFocusNodeId?: string | null;
  flowFocusRelatedIds?: Set<string>;
  onFlowNodeHoverEnter?: (treeNodeId: string) => void;
  onFlowNodeHoverLeave?: () => void;
  /** Click a machine card to pin its supply branch until cleared */
  onFlowNodePinToggle?: (treeNodeId: string) => void;
  /** Horizontal slices: reorder siblings under the same parent (vertical only). */
  onReorderSliceSiblings?: (parentId: string, activeId: string, insertBeforeId: string | null) => void;
  /** Vertical reorder across all nodes in a column (regardless of tree parent group). Updates displayColumnPosition. */
  onReorderColumnPosition?: (sliceIdx: number, activeId: string, insertBeforeId: string | null) => void;
  /** Move a node to another display column (does not change flow math; only `displaySliceIndex` + child order). */
  onMoveNodeDisplaySlice?: (
    parentId: string,
    activeId: string,
    targetSliceIdx: number,
    insertBeforeId: string | null
  ) => void;
  /** Open quick build modal — only passed when the chart has no machines yet. */
  onQuickBuild?: () => void;
  /** Items imported into this factory from other factories — shown at top of slice 0. */
  factoryImports?: FactoryImportRow[];
  /** Clear the entire factory tree (resets to empty). Called when the root non-extractor is deleted. */
  onClearTree?: () => void;
}
