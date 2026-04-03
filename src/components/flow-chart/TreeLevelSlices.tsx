"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AddMachineModal } from "@/components/flow-chart/AddMachineModal";
import { FlowNodeCard } from "@/components/flow-chart/FlowNodeCard";
import {
  HorizontalSliceMachineReorder,
  SliceBranchReorderGroup,
  SliceBranchShiftedChrome,
  SliceColumnSurface,
  SliceDragColumnProvider,
} from "@/components/flow-chart/sliceBranchReorder";
import { formatRate, getItemName } from "@/components/flow-chart/flowChartDisplay";
import type { TreeLevelProps } from "@/components/flow-chart/treeLevelTypes";
import type { MachineOption } from "@/components/flow-chart/flowChartTypes";
import {
  getAllMachineOptions,
  getExtractorMachineOptionsFull,
  getMachineOptionsForInput,
  getRecipeInputsPerMinute,
  sortOptionsNonAltFirst,
} from "@/lib/chain";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import {
  getEffectiveOutputPerMachine,
  getTotalClockFraction,
  type InputEdge,
  type TreeNode,
} from "@/lib/flowChartModel";
import { getChildDemandForParentOutput } from "@/lib/flowChartFlowRates";
import { pickDefaultBelt } from "@/lib/flowChartPickBelt";
import { getNodePowerDisplay } from "@/lib/flowChartPower";
import {
  getTransportOptionsForItem,
  getTransportRateForItem,
  normalizeTransportForItem,
} from "@/lib/flowTransport";
import { isSliceDragDebugEnabled, sliceDragDebug } from "@/components/flow-chart/sliceDragDebug";
import {
  EMPTY_FLOW_RELATED_IDS,
  findNode,
  getDisplaySlices,
  groupSliceNodesByParent,
} from "@/lib/flowChartTree";
import type { KeyName } from "@/lib/types";

const TRAILING_SLICE_MARKERS = 1;

/** One belt / input row above a machine in horizontal slice view */
export type SliceBeltRow = {
  nodeId: string;
  parentId: string;
  itemKey: KeyName;
  isInputEdge: boolean;
  beltKey: string;
  beltApplies: boolean;
  isBeltLimited: boolean;
  isUnderfed: boolean;
  machineLabel: string;
};

/** Slice-based horizontal layout: columns with header/footer, branch-grouped machines, curved connectors */
export function TreeLevelSlices(props: TreeLevelProps) {
  const { tree } = props;

  useEffect(() => {
    if (!isSliceDragDebugEnabled()) return;
    sliceDragDebug("TreeLevelSlices", {
      hasRootProduct: !!tree.node.outputItemKey,
      hint: tree.node.outputItemKey
        ? "Slice column logs follow from TreeLevelSlicesBody."
        : "No root product yet — add a machine or load a chart to use horizontal slices; drag logs need machines.",
    });
  }, [tree.node.outputItemKey]);

  if (!tree.node.outputItemKey) {
    return <TreeLevelSlicesEmpty {...props} />;
  }
  return (
    <SliceDragColumnProvider>
      <TreeLevelSlicesBody {...props} />
    </SliceDragColumnProvider>
  );
}

function TreeLevelSlicesEmpty(props: TreeLevelProps) {
  const { tree, onAddMachine, factoryImports = [] } = props;
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [addMachineParent, setAddMachineParent] = useState<TreeNode | null>(null);
  const emptySlices = Array.from({ length: 1 + TRAILING_SLICE_MARKERS }, (_, i) => i);

  return (
    <div className="flex min-h-0 min-w-0 flex-row items-stretch gap-0 py-6">
      {emptySlices.map((sliceIdx) => (
        <div
          key={`empty-slice-${sliceIdx}`}
          className="relative flex min-h-full min-w-[220px] max-w-[220px] snap-start flex-col border-x border-dashed border-zinc-600 py-3"
        >
          {sliceIdx === 0 && (
            <div className="pointer-events-auto absolute left-0 right-0 top-0 z-10 hidden border-b border-zinc-800 bg-zinc-950/95 px-2 py-2 lg:block">
              <div className="mb-1 text-center text-[10px] text-zinc-500">INPUT</div>
              <div className="flex flex-col gap-1.5">
                {factoryImports.length > 0 ? (
                  factoryImports.map((imp) => (
                    <div
                      key={`import-empty-${imp.itemKey}-${imp.fromFactoryName}`}
                      className="flex items-center gap-1 rounded-lg border border-sky-900/60 bg-sky-950/40 px-2 py-1.5 text-xs"
                    >
                      <span className="font-medium text-sky-300">
                        {formatRate(imp.ratePerMin)} {getItemName(imp.itemKey, "compact")}
                      </span>
                      <span className="ml-auto truncate text-sky-500/70">↓ {imp.fromFactoryName}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                    <span className="font-medium text-zinc-400">No input</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute left-0 right-0 top-1 text-center text-[10px] uppercase tracking-wide text-zinc-600">
            {`Slice ${sliceIdx}`}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {sliceIdx === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAddMachineParent(tree);
                  setAddMachineOpen(true);
                }}
                className="flex min-h-[120px] min-w-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-600 bg-zinc-900/50 p-6 transition hover:border-amber-500/40 hover:bg-zinc-800/80"
              >
                <span className="text-3xl font-light text-zinc-400">+</span>
                <span className="text-center text-sm font-medium text-zinc-400">Add machine</span>
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {addMachineOpen && (
        <AddMachineModal
          title="Add machine"
          options={getAllMachineOptions()}
          onSelect={(opt) => {
            if (addMachineParent) onAddMachine(addMachineParent, opt, 0);
            setAddMachineOpen(false);
          }}
          onClose={() => setAddMachineOpen(false)}
        />
      )}
    </div>
  );
}

function TreeLevelSlicesBody(props: TreeLevelProps) {
  const {
    tree,
    mobileMode = false,
    flowRates,
    onUpdateNode,
    onSelectNodeMachine,
    onAddMachine,
    onUpdateChildBelt,
    onUpdateInputEdgeBelt,
    onMergeNodes,
    onMergeCrossParent,
    onBreakOutMachine,
    removeNode,
    flowFocusNodeId = null,
    flowFocusRelatedIds = EMPTY_FLOW_RELATED_IDS,
    onFlowNodeHoverEnter,
    onFlowNodeHoverLeave,
    onFlowNodePinToggle,
    onReorderSliceSiblings,
    onReorderColumnPosition,
    onMoveNodeDisplaySlice,
    factoryImports = [],
    onClearTree,
  } = props;

  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [addMachineParent, setAddMachineParent] = useState<TreeNode | null>(null);
  const [addMachineInsertIndex, setAddMachineInsertIndex] = useState<number | undefined>(undefined);
  const [addMachineSliceIdx, setAddMachineSliceIdx] = useState(0);
  const [, setAddMachinePrevSlice] = useState<TreeNode[] | null>(null);
  const [addMachineAllPrevSlices, setAddMachineAllPrevSlices] = useState<TreeNode[][] | null>(null);
  const [addMachineOptionsFiltered, setAddMachineOptionsFiltered] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState<Set<number>>(new Set());
  const [outputExpanded, setOutputExpanded] = useState<Set<number>>(new Set());

  const slices = getDisplaySlices(tree);
  const isEmpty = slices.length === 0;
  const slicesForDisplay = useMemo((): TreeNode[][] => {
    if (isEmpty) return slices;
    // Always append trailing empty columns so users can see where next stages would go.
    const trailingSlices = Array.from({ length: TRAILING_SLICE_MARKERS }, () => [] as TreeNode[]);
    return [...slices, ...trailingSlices];
  }, [isEmpty, slices]);
  const mobileSliceSignature = useMemo(
    () => slicesForDisplay.map((slice) => slice.map((n) => n.id).join(",")).join("|"),
    [slicesForDisplay]
  );
  const mobileLaneRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!isSliceDragDebugEnabled()) return;
    if (isEmpty) {
      sliceDragDebug(
        "display layout: no slices (empty chart or getDisplaySlices returned []) — add machines to see column groups"
      );
      return;
    }
    sliceDragDebug(
      "display layout (groups per slice column)",
      slices.map((sliceNodes, sliceIdx) => ({
        sliceIdx,
        groups: groupSliceNodesByParent(tree, sliceNodes).map((g) => ({
          parentId: g.parentId,
          nodeIds: g.nodes.map((n) => n.id),
          displaySliceIndex: g.nodes.map((n) => n.displaySliceIndex),
        })),
      }))
    );
    for (const [sliceIdx, sliceNodes] of slices.entries()) {
      const groups = groupSliceNodesByParent(tree, sliceNodes);
      if (groups.length > 0) {
        const summary = groups.map((g) =>
          `parent=${g.parentId?.slice(-6) ?? "ROOT"} nodes=[${g.nodes.map((n) => n.id.slice(-6)).join(",")}]`
        ).join(" | ");
        sliceDragDebug(`col ${sliceIdx} groups: ${summary}`);
      }
    }
  }, [slices, isEmpty, tree]);

  useEffect(() => {
    if (!mobileMode) return;
    const raf = requestAnimationFrame(() => {
      for (const [idxRaw, lane] of Object.entries(mobileLaneRefs.current)) {
        if (!lane) continue;
        const sliceIdx = Number(idxRaw);
        const nodeCount = slicesForDisplay[sliceIdx]?.length ?? 0;
        const max = lane.scrollWidth - lane.clientWidth;
        lane.scrollLeft = nodeCount > 1 ? 0 : max > 0 ? max / 2 : 0;
      }
    });
    const raf2 = requestAnimationFrame(() => {
      for (const [idxRaw, lane] of Object.entries(mobileLaneRefs.current)) {
        if (!lane) continue;
        const sliceIdx = Number(idxRaw);
        const nodeCount = slicesForDisplay[sliceIdx]?.length ?? 0;
        const max = lane.scrollWidth - lane.clientWidth;
        lane.scrollLeft = nodeCount > 1 ? 0 : max > 0 ? max / 2 : 0;
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
    };
  }, [mobileMode, mobileSliceSignature, slicesForDisplay]);

  if (isEmpty) return null;

  const childOptions = (
    parent: TreeNode,
    sliceIdx: number,
    allPrevSlices: TreeNode[][]
  ): { options: MachineOption[]; isFiltered: boolean } => {
    let opts: MachineOption[];
    let isFiltered = false;

    if (!parent.node.outputItemKey) {
      opts = getAllMachineOptions();
    } else if (sliceIdx === 0 && parent.node.isRaw) {
      // Only include extractors for the same resource as the parent (not all extractors).
      const sameResourceExtractors = getExtractorMachineOptionsFull().filter(
        (o) => o.outputItemKey === parent.node.outputItemKey
      );
      const consumers = getMachineOptionsForInput(parent.node.outputItemKey);
      opts = [...sameResourceExtractors, ...consumers];
      isFiltered = true;
    } else if (sliceIdx > 0 && allPrevSlices.length > 0) {
      const seen = new Set<string>();
      const combined: MachineOption[] = [];
      for (const slice of allPrevSlices) {
        for (const node of slice) {
          const itemKey = node.node.outputItemKey;
          if (!itemKey) continue;
          for (const opt of getMachineOptionsForInput(itemKey)) {
            if (!seen.has(opt.recipeKey)) {
              seen.add(opt.recipeKey);
              combined.push(opt);
            }
          }
        }
      }
      opts = combined;
      isFiltered = true;
    } else {
      opts = getMachineOptionsForInput(parent.node.outputItemKey);
      isFiltered = true;
    }

    return { options: sortOptionsNonAltFirst(opts), isFiltered };
  };

  if (mobileMode) {
    return (
      <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col gap-3 py-2">
        {slicesForDisplay.map((sliceNodes, sliceIdx) => {
          const showSliceAddButton =
            sliceNodes.length === 0 &&
            ((sliceIdx > 0 ? (slices[sliceIdx - 1]?.length ?? 0) : 0) > 0);
          const canAddInThisSlice = showSliceAddButton || (sliceIdx === 0 && sliceNodes.length === 0);
          const openMobileAdd = (
            parentNode: TreeNode,
            insertIndex: number,
            targetSliceIdx: number
          ) => {
            const allPrev = slices.slice(0, targetSliceIdx);
            setAddMachineParent(parentNode);
            setAddMachineInsertIndex(insertIndex);
            setAddMachineSliceIdx(targetSliceIdx);
            setAddMachineAllPrevSlices(allPrev);
            setAddMachineOptionsFiltered(childOptions(parentNode, targetSliceIdx, allPrev).isFiltered);
            setAddMachineOpen(true);
          };

          return (
            <div
              key={`mobile-slice-${sliceIdx}`}
              className="w-full max-w-full border-t border-dashed border-zinc-600"
            >
              <div
                ref={(el) => {
                  mobileLaneRefs.current[sliceIdx] = el;
                }}
                className="slice-lane-scroll w-full max-w-full overflow-x-scroll overflow-y-hidden px-2 py-3 pb-4"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                <div className={`mx-auto flex w-max min-w-full ${sliceNodes.length > 1 ? "justify-start" : "justify-center"} gap-3`}>
                {sliceNodes.map((node, i) => {
                  const allPrevSlices = slices.slice(0, sliceIdx);
                  const { options: opts } = childOptions(node, sliceIdx, allPrevSlices);
                  const parent = node.parentId ? findNode(tree, node.parentId) : null;
                  const parentTree = parent ?? tree;
                  const isRootRow = node.id === tree.id;
                  const childIdx =
                    parentTree && !isRootRow
                      ? parentTree.children.findIndex((c) => c.id === node.id)
                      : -1;
                  const allProduces = node.node.isRaw
                    ? getExtractorMachineOptionsFull()
                    : allPrevSlices.length > 0
                      ? (() => {
                          const seen = new Set<string>();
                          return allPrevSlices.flatMap((s) =>
                            s.flatMap((n) =>
                              getMachineOptionsForInput(n.node.outputItemKey).filter((o) => {
                                if (seen.has(o.recipeKey)) return false;
                                seen.add(o.recipeKey);
                                return true;
                              })
                            )
                          );
                        })()
                      : parent
                        ? getMachineOptionsForInput(parent.node.outputItemKey)
                        : [];
                  const producesOpts = allProduces.filter((o) => o.buildingKey === node.node.buildingKey);
                  const power = getNodePowerDisplay(node.node, flowRates.get(node.id));

                  return (
                    <div key={`mobile-node-${node.id}`} className="shrink-0">
                      <div className="flex items-center gap-2">
                        {i === 0 && (
                          <button
                            type="button"
                            title="Add machine before"
                            onClick={() =>
                              openMobileAdd(
                                parentTree,
                                isRootRow ? 0 : Math.max(0, childIdx),
                                sliceIdx
                              )
                            }
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                          >
                            +
                          </button>
                        )}
                        <div className="flex flex-col items-center">
                          <FlowNodeCard
                            node={node.node}
                            machineOptions={opts}
                            producesOptions={producesOpts}
                            isOpen={false}
                            onToggleOpen={() => {}}
                            onUpdate={(u) => onUpdateNode(node.id, u)}
                            onSelectMachine={(opt) => onSelectNodeMachine(node.id, opt)}
                            onRemove={parent ? () => removeNode(parent.id, node.id) : undefined}
                            onBreakOut={
                              parent && onBreakOutMachine
                                ? (machineIndex) => onBreakOutMachine(parent.id, node.id, machineIndex)
                                : undefined
                            }
                            totalDemand={node.children.reduce((s, c) => s + getChildDemandForParentOutput(c, node.node.outputItemKey), 0)}
                            childCount={node.children.length}
                            flowData={flowRates.get(node.id)}
                            incomingBeltKey={node.incomingBeltKey}
                            fixedWidth
                            flowHighlightSelf={flowFocusNodeId === node.id}
                            flowHighlightRelated={flowFocusRelatedIds.has(node.id)}
                            onFlowPinClick={
                              onFlowNodePinToggle ? () => onFlowNodePinToggle(node.id) : undefined
                            }
                          />
                          {power && (
                            <div className="mt-1 flex w-[200px] justify-center rounded-lg border border-zinc-700 bg-zinc-800/90 px-2 py-1">
                              <div
                                className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                  power.isGenerating ? "text-emerald-300" : "text-red-300"
                                }`}
                                title={`${power.isGenerating ? "Generating" : "Consuming"} ${formatRate(power.mw)} MW`}
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
                                </svg>
                                <span>{power.isGenerating ? "+" : "-"}{formatRate(power.mw)} MW</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          title={
                            i < sliceNodes.length - 1
                              ? "Add machine between"
                              : "Add machine after"
                          }
                          onClick={() =>
                            openMobileAdd(
                              parentTree,
                              isRootRow
                                ? tree.children.length
                                : childIdx >= 0
                                  ? childIdx + 1
                                  : parentTree.children.length,
                              sliceIdx
                            )
                          }
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              {canAddInThisSlice && (
                <div className="flex justify-center px-2 pb-3">
                  <button
                    type="button"
                    title="Add machine in this slice"
                    onClick={() => {
                      openMobileAdd(tree, tree.children.length, sliceIdx);
                    }}
                    className="flex h-10 w-10 shrink-0 snap-start items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {addMachineOpen && addMachineParent && (
          <AddMachineModal
            title="Add machine"
            options={childOptions(addMachineParent, addMachineSliceIdx, addMachineAllPrevSlices ?? []).options}
            allOptions={addMachineOptionsFiltered ? getAllMachineOptions() : undefined}
            onSelect={(opt) => {
              const parent = addMachineParent!;
              const insertIndex = addMachineInsertIndex ?? parent.children.length;
              const inputEdges: InputEdge[] = [];
              const allPrev = addMachineAllPrevSlices ?? [];
              const parentProduces = parent?.node.outputItemKey;
              if (opt.recipeKey && allPrev.length > 0 && parent) {
                const inputs = getRecipeInputsPerMinute(opt.recipeKey);
                for (const inp of inputs) {
                  if (parentProduces === inp.itemKey) continue;
                  let producer: TreeNode | undefined;
                  for (let s = allPrev.length - 1; s >= 0; s--) {
                    producer = allPrev[s]!.find((n) => n.node.outputItemKey === inp.itemKey);
                    if (producer) break;
                  }
                  if (producer) {
                    inputEdges.push({
                      itemKey: inp.itemKey,
                      producerId: producer.id,
                      beltKey: pickDefaultBelt(inp.perMinute, inp.itemKey),
                    });
                  }
                }
              }
              onAddMachine(
                parent,
                opt,
                insertIndex,
                inputEdges.length > 0 ? inputEdges : undefined,
                addMachineSliceIdx
              );
              setAddMachineOpen(false);
            }}
            onClose={() => setAddMachineOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-auto min-h-0 flex-row items-stretch gap-0"
      data-slice-columns-scope=""
    >
      {slicesForDisplay.map((sliceNodes, sliceIdx) => {
        const prevSlice = sliceIdx > 0 ? slices[sliceIdx - 1]! : null;
        const showSliceAddButton =
          sliceNodes.length === 0 &&
          ((sliceIdx > 0 ? (slices[sliceIdx - 1]?.length ?? 0) : 0) > 0);
        const getNodeOutputs = (node: TreeNode): Array<{ itemKey: KeyName; rate: number }> => {
          const fd = flowRates.get(node.id) as FlowRateData | undefined;
          if (fd && "outputs" in fd && fd.outputs && fd.outputs.length > 0) {
            return fd.outputs
              .filter((o) => o.currentOutput > 0.001)
              .map((o) => ({ itemKey: o.itemKey, rate: o.currentOutput }));
          }
          const itemKey = node.node.outputItemKey as KeyName | undefined;
          if (!itemKey) return [];
          const rate =
            fd && "currentOutput" in fd
              ? fd.currentOutput
              : getEffectiveOutputPerMachine(node.node) * getTotalClockFraction(node.node);
          return [{ itemKey, rate }];
        };

        const inputsByItem = new Map<KeyName, { rate: number; consumers: SliceBeltRow[] }>();
        if (sliceNodes.length > 0 || sliceIdx > 0) {
          const allPrevSlices = sliceIdx > 0 ? slices.slice(0, sliceIdx) : [];
          // Build a running net pool: for each previous slice, add its outputs then subtract its consumption.
          // This gives the true remaining supply available when this column is reached.
          const totalRateByItem = new Map<KeyName, number>();
          // Seed with factory imports (external supply into slice 0)
          if (sliceIdx > 0) {
            for (const imp of factoryImports) {
              totalRateByItem.set(imp.itemKey, (totalRateByItem.get(imp.itemKey) ?? 0) + imp.ratePerMin);
            }
          }
          for (const slice of allPrevSlices) {
            // Add outputs
            for (const node of slice) {
              for (const out of getNodeOutputs(node)) {
                totalRateByItem.set(out.itemKey, (totalRateByItem.get(out.itemKey) ?? 0) + out.rate);
              }
            }
            // Subtract actual consumption from the pool (need × utilization, not receivesInput).
            for (const node of slice) {
              const fd = flowRates.get(node.id) as FlowRateData | undefined;
              if (fd && "inputs" in fd && fd.inputs && "utilization" in fd) {
                for (const inp of fd.inputs) {
                  const actualConsumed = inp.needsInput * (fd as FlowRateData).utilization;
                  const current = totalRateByItem.get(inp.itemKey) ?? 0;
                  totalRateByItem.set(inp.itemKey, Math.max(0, current - actualConsumed));
                }
              } else if (fd && "receivesInput" in fd && fd.receivesInput > 0) {
                const parent = node.parentId ? findNode(tree, node.parentId) : null;
                const parentKey = parent?.node.outputItemKey as KeyName | undefined;
                if (parentKey) {
                  const actual = (fd as FlowRateData).needsInput * ((fd as FlowRateData).utilization ?? 1);
                  const current = totalRateByItem.get(parentKey) ?? 0;
                  totalRateByItem.set(parentKey, Math.max(0, current - actual));
                }
              }
            }
          }
          // Same-column producers also supply the pool (computeFlowRates); include them in belt/header rows.
          for (const node of sliceNodes) {
            for (const out of getNodeOutputs(node)) {
              totalRateByItem.set(out.itemKey, (totalRateByItem.get(out.itemKey) ?? 0) + out.rate);
            }
          }
          for (const [itemKey, rate] of totalRateByItem) {
            const consumers = sliceNodes
              .filter((n) => {
                if (!n.node.recipeKey) return false;
                const inputs = getRecipeInputsPerMinute(n.node.recipeKey);
                return inputs.some((i) => i.itemKey === itemKey);
              })
              .map((consumer) => {
                const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
                const fromParent = !edge && (consumer.parentId ? findNode(tree, consumer.parentId) : null)?.node.outputItemKey === itemKey;
                let beltKey = normalizeTransportForItem(itemKey);
                let beltCapacity = 0;
                if (edge) {
                  beltKey = edge.beltKey;
                  beltCapacity = getTransportRateForItem(itemKey, edge.beltKey);
                } else if (fromParent) {
                  beltKey = normalizeTransportForItem(itemKey, consumer.incomingBeltKey);
                  const consumerFd = flowRates.get(consumer.id) as FlowRateData | undefined;
                  beltCapacity = consumerFd && "beltCapacity" in consumerFd ? consumerFd.beltCapacity : 0;
                }
                const consumerFd = flowRates.get(consumer.id) as FlowRateData | undefined;
                const inp = consumerFd?.inputs?.find((i) => i.itemKey === itemKey);
                const receivesInput = inp?.receivesInput ?? 0;
                const needsInput = inp?.needsInput ?? 0;
                const isBeltLimited = beltCapacity > 0 && needsInput > 0 && receivesInput >= beltCapacity - 0.5 && receivesInput < needsInput - 0.5;
                const isUnderfed = needsInput > 0 && receivesInput < needsInput - 0.5;
                const beltApplies = !!edge || fromParent;
                const row: SliceBeltRow = {
                  nodeId: consumer.id,
                  parentId: edge ? "" : (consumer.parentId ?? ""),
                  itemKey,
                  isInputEdge: !!edge,
                  beltKey,
                  beltApplies,
                  isBeltLimited,
                  isUnderfed,
                  machineLabel: getItemName(consumer.node.outputItemKey, "compact"),
                };
                return row;
              });
            if (consumers.length > 0 || sliceNodes.length === 0) {
              if (rate > 0.001) inputsByItem.set(itemKey, { rate, consumers });
            }
          }
        }

        const outputsByItem = new Map<KeyName, number>();
        for (const node of sliceNodes) {
          for (const out of getNodeOutputs(node)) {
            outputsByItem.set(out.itemKey, (outputsByItem.get(out.itemKey) ?? 0) + out.rate);
          }
        }

        const allConsumers: SliceBeltRow[] = Array.from(inputsByItem.values()).flatMap(({ consumers }) => consumers);
        const hasAnyRed = allConsumers.some((c) => c.isBeltLimited);
        const isExpanded = headerExpanded.has(sliceIdx);
        const sliceImports = sliceIdx === 0 ? factoryImports : [];
        const hasMoreThanTwoLines = inputsByItem.size + sliceImports.length > 2;
        const beltsByNodeId = new Map<string, SliceBeltRow[]>();
        for (const c of allConsumers) {
          const list = beltsByNodeId.get(c.nodeId) ?? [];
          list.push(c);
          beltsByNodeId.set(c.nodeId, list);
        }

        const hasFloatingOutput = outputsByItem.size > 0;
        /** h-6 + h-22 + py-3 body gutter — matches old in-flow layout; floats do not participate in flex */
        const sliceFloatPadY = "lg:pt-[7.75rem]";
        // Always reserve the same bottom space as the top so justify-center lands at the same visual
        // midpoint across all columns, regardless of whether a column has a floating OUTPUT bar.
        const sliceFloatPadBottom = "lg:pb-[7.75rem]";

        return (
          <Fragment key={sliceIdx}>
            <SliceColumnSurface
              sliceIdx={sliceIdx}
              className="relative flex min-h-full min-w-[220px] max-w-[220px] snap-start flex-col overflow-visible border-x border-dashed border-zinc-600"
            >
              {/* Machines + trailing "+": stacked; translate shifts block down by half the "+" row so only the card center aligns with column center */}
              <div
                className={`flex min-h-0 flex-1 flex-col overflow-hidden py-3 ${sliceFloatPadY} ${sliceFloatPadBottom}`}
              >
                <div
                  className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden"
                >
                  <div className="flex flex-col items-center translate-y-5.5">
                    <div className="flex flex-col items-center">
                {showSliceAddButton && (
                  /* Empty column: root was moved here or no machines placed yet — offer a quick add */
                  <div className="flex w-full justify-center py-4">
                    <button
                      type="button"
                      title="Add machine to this slice"
                      onClick={() => {
                        const allPrev = slices.slice(0, sliceIdx);
                        setAddMachineParent(tree);
                        setAddMachineInsertIndex(tree.children.length);
                        setAddMachineSliceIdx(sliceIdx);
                        setAddMachinePrevSlice(sliceIdx > 0 ? (slices[sliceIdx - 1] ?? null) : null);
                        setAddMachineAllPrevSlices(allPrev);
                        setAddMachineOptionsFiltered(childOptions(tree, sliceIdx, allPrev).isFiltered);
                        setAddMachineOpen(true);
                      }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                    >
                      +
                    </button>
                  </div>
                )}
                {(() => {
                  /** All node IDs in this column in current display order — used for column-wide vertical reorder. */
                  const columnNodeIds = sliceNodes.map((n) => n.id);
                  const branchGroups = groupSliceNodesByParent(tree, sliceNodes);
                  return branchGroups.flatMap((branchGroup, branchIdx) => {
                  const groupEl = (
                  <SliceBranchReorderGroup
                    key={branchGroup.parentId ?? `slice-${sliceIdx}-root-${branchIdx}`}
                    siblingIds={branchGroup.nodes.map((n) => n.id)}
                    parentIdAttr={branchGroup.parentId ?? ""}
                  >
                {branchGroup.nodes.flatMap((node, i) => {
                  const allPrevSlices = slices.slice(0, sliceIdx);
                  const { options: opts } = childOptions(node, sliceIdx, allPrevSlices);
                  const parentTree =
                    branchGroup.parentId != null ? findNode(tree, branchGroup.parentId) : tree;
                  const parent =
                    branchGroup.parentId != null ? parentTree : node.parentId ? findNode(tree, node.parentId) : null;
                  /** Tree root row is not in `tree.children`, so findIndex is -1 — use prepend/append indices instead */
                  const isRootRow = node.id === tree.id;
                  const childIdx =
                    parentTree != null && !isRootRow
                      ? parentTree.children.findIndex((c) => c.id === node.id)
                      : -1;
                  /** Full sibling order under the parent (not slice-local); required for cross-slice drop hit-testing. */
                  const parentOrderedChildIds =
                    branchGroup.parentId != null && parentTree
                      ? parentTree.children.map((c) => c.id)
                      : branchGroup.nodes.map((n) => n.id);
                  const allProduces = node.node.isRaw
                    ? getExtractorMachineOptionsFull()
                    : allPrevSlices.length > 0
                      ? (() => {
                          const seen = new Set<string>();
                          return allPrevSlices.flatMap((s) =>
                            s.flatMap((n) =>
                              getMachineOptionsForInput(n.node.outputItemKey).filter((o) => {
                                if (seen.has(o.recipeKey)) return false;
                                seen.add(o.recipeKey);
                                return true;
                              })
                            )
                          );
                        })()
                      : parent
                        ? getMachineOptionsForInput(parent.node.outputItemKey)
                        : [];
                  const producesOpts = allProduces.filter((o) => o.buildingKey === node.node.buildingKey);
                  const nextNode =
                    i < branchGroup.nodes.length - 1 ? branchGroup.nodes[i + 1]! : null;
                  const canMergeWithNext =
                    nextNode != null &&
                    onMergeNodes &&
                    parent &&
                    branchGroup.parentId != null &&
                    node.node.outputItemKey &&
                    nextNode.node.outputItemKey &&
                    node.node.outputItemKey === nextNode.node.outputItemKey;
                  const nextGroup = branchGroups[branchIdx + 1];
                  const firstNextNode = nextGroup?.nodes[0];
                  const canCrossMergeAfterGroup =
                    i === branchGroup.nodes.length - 1 &&
                    onMergeCrossParent &&
                    firstNextNode &&
                    node.node.outputItemKey === firstNextNode.node.outputItemKey;

                  const openAddSibling = (insertIndex: number) => {
                    if (!parentTree) return;
                    const allPrev = slices.slice(0, sliceIdx);
                    setAddMachineParent(parentTree);
                    setAddMachineInsertIndex(insertIndex);
                    setAddMachineSliceIdx(sliceIdx);
                    setAddMachinePrevSlice(sliceIdx > 0 ? prevSlice : null);
                    setAddMachineAllPrevSlices(allPrev);
                    setAddMachineOptionsFiltered(childOptions(parentTree, sliceIdx, allPrev).isFiltered);
                    setAddMachineOpen(true);
                  };

                  const sliceAddBtn =
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40";

                  const pieces: ReactNode[] = [];

                  /**
                   * Suppress the top "+" for any group that is not the first group in this column.
                   * The previous group's bottom "+" already acts as the "between" button, so we
                   * don't need a second one at the top of the next group.
                   * Columns are pure display (factory floors) — tree parent/child order is not
                   * enforced on columns, so any machine can sit in any column.
                   */
                  const suppressTopAdd = branchIdx > 0;

                  if (
                    i === 0 &&
                    parentTree &&
                    (isRootRow || childIdx >= 0) &&
                    !suppressTopAdd
                  ) {
                    pieces.push(
                      <div key={`add-above-${node.id}`} className="flex w-full justify-center py-2">
                        <button
                          type="button"
                          title="Add machine above"
                          onClick={() => openAddSibling(isRootRow ? 0 : childIdx)}
                          className={sliceAddBtn}
                        >
                          +
                        </button>
                      </div>
                    );
                  }

                  const isRootNode = node.id === tree.id;
                  const isExtractorRoot = isRootNode && node.node.isRaw;

                  pieces.push(
                    <HorizontalSliceMachineReorder
                      key={node.id}
                      disabled={
                        isExtractorRoot ||
                        (!branchGroup.parentId && !isRootNode) ||
                        (
                          (!onReorderSliceSiblings || branchGroup.nodes.length < 2) &&
                          !onMoveNodeDisplaySlice &&
                          !onReorderColumnPosition
                        )
                      }
                      parentId={branchGroup.parentId}
                      nodeId={node.id}
                      siblingIndex={i}
                      sliceIdx={sliceIdx}
                      parentOrderedChildIds={parentOrderedChildIds}
                      columnNodeIds={columnNodeIds}
                      onReorderComplete={(columnInsertBeforeId) => {
                        // Always update column visual order.
                        if (onReorderColumnPosition) {
                          onReorderColumnPosition(sliceIdx, node.id, columnInsertBeforeId);
                        }
                        // Also update tree sibling order when the drop target is in the same parent group.
                        if (branchGroup.parentId && onReorderSliceSiblings) {
                          const isSameGroupTarget =
                            columnInsertBeforeId === null ||
                            (parentTree?.children ?? []).some((c) => c.id === columnInsertBeforeId);
                          if (isSameGroupTarget) {
                            onReorderSliceSiblings(branchGroup.parentId, node.id, columnInsertBeforeId);
                          }
                        }
                      }}
                      onMoveDisplaySlice={
                        onMoveNodeDisplaySlice
                          ? (targetSliceIdx, insertBeforeId) => {
                              onMoveNodeDisplaySlice(branchGroup.parentId ?? "", node.id, targetSliceIdx, insertBeforeId);
                            }
                          : undefined
                      }
                    >
                    <div
                      data-slice-machine-row={node.id}
                      className="flex shrink-0 select-none flex-col items-center gap-2"
                    >
                      {(() => {
                        const beltsForNode = beltsByNodeId.get(node.id) ?? [];
                        if (beltsForNode.length === 0) return null;
                        return (
                          <div className="flex w-[200px] flex-col gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/90 px-2 py-1">
                            {beltsForNode.map(
                              ({
                                nodeId,
                                parentId,
                                itemKey: ik,
                                isInputEdge,
                                beltKey,
                                beltApplies,
                                isBeltLimited,
                                isUnderfed,
                              }) => (
                              <div
                                key={`${nodeId}-${ik}`}
                                className={`flex items-center justify-between gap-2 text-xs ${
                                  isBeltLimited ? "text-red-400" : isUnderfed ? "text-amber-400" : "text-zinc-300"
                                }`}
                              >
                                <span className="min-w-0 truncate">{getItemName(ik, "compact")}</span>
                                {beltApplies ? (
                                <select
                                  value={normalizeTransportForItem(ik, beltKey)}
                                  onChange={(e) =>
                                    isInputEdge && onUpdateInputEdgeBelt
                                      ? onUpdateInputEdgeBelt(nodeId, ik, e.target.value)
                                      : onUpdateChildBelt(parentId, nodeId, e.target.value)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={`flex shrink-0 cursor-pointer appearance-none border-none bg-transparent py-0 pr-5 text-right focus:outline-none focus:ring-0 ${
                                    isBeltLimited ? "text-red-400" : isUnderfed ? "text-amber-400" : "text-zinc-400"
                                  }`}
                                  title={isBeltLimited ? "Limiting flow" : ""}
                                  style={{
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23717171'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                                    backgroundRepeat: "no-repeat",
                                    backgroundPosition: "right 0 center",
                                    backgroundSize: "1rem",
                                  }}
                                >
                                  {getTransportOptionsForItem(ik).map((t) => (
                                    <option key={t.key_name} value={t.key_name}>
                                      {formatRate(t.rate)}/min
                                    </option>
                                  ))}
                                </select>
                                ) : (
                                  <span
                                    className="shrink-0 text-right text-zinc-500"
                                    title="Same-column pool; not a dedicated belt in the model"
                                  >
                                    Pool
                                  </span>
                                )}
                              </div>
                            )
                            )}
                          </div>
                        );
                      })()}
                      <FlowNodeCard
                        node={node.node}
                        machineOptions={opts}
                        producesOptions={producesOpts}
                        isOpen={false}
                        onToggleOpen={() => {}}
                        onUpdate={(u) => onUpdateNode(node.id, u)}
                        onSelectMachine={(opt) => onSelectNodeMachine(node.id, opt)}
                        onRemove={
                          parent
                            ? () => removeNode(parent.id, node.id)
                            : isRootNode && !isExtractorRoot && node.children.length === 0 && onClearTree
                              ? onClearTree
                              : undefined
                        }
                        onBreakOut={
                          parent && onBreakOutMachine
                            ? (machineIndex) => onBreakOutMachine(parent.id, node.id, machineIndex)
                            : undefined
                        }
                        totalDemand={node.children.reduce((s, c) => s + getChildDemandForParentOutput(c, node.node.outputItemKey), 0)}
                        childCount={node.children.length}
                        flowData={flowRates.get(node.id)}
                        incomingBeltKey={node.incomingBeltKey}
                        fixedWidth
                        flowHighlightSelf={flowFocusNodeId === node.id}
                        flowHighlightRelated={flowFocusRelatedIds.has(node.id)}
                        onFlowHoverEnter={
                          onFlowNodeHoverEnter ? () => onFlowNodeHoverEnter(node.id) : undefined
                        }
                        onFlowHoverLeave={onFlowNodeHoverLeave}
                        onFlowPinClick={
                          onFlowNodePinToggle ? () => onFlowNodePinToggle(node.id) : undefined
                        }
                      />
                      {(() => {
                        const power = getNodePowerDisplay(node.node, flowRates.get(node.id));
                        if (!power) return null;
                        return (
                          <div className="mt-0.5 flex w-[200px] justify-center rounded-lg border border-zinc-700 bg-zinc-800/90 px-2 py-1">
                            <div
                              className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                power.isGenerating ? "text-emerald-300" : "text-red-300"
                              }`}
                              title={`${power.isGenerating ? "Generating" : "Consuming"} ${formatRate(power.mw)} MW`}
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
                              </svg>
                              <span>{power.isGenerating ? "+" : "-"}{formatRate(power.mw)} MW</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    </HorizontalSliceMachineReorder>
                  );

                  if (parentTree && (isRootRow || childIdx >= 0)) {
                    pieces.push(
                      <SliceBranchShiftedChrome
                        key={`add-below-${node.id}`}
                        siblingIndex={i + 1}
                        className="flex shrink-0 items-center justify-center gap-1 py-2"
                      >
                        {canCrossMergeAfterGroup ? (
                          <button
                            type="button"
                            onClick={() => onMergeCrossParent!(node.id, firstNextNode!.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                            title="Combine these machine groups"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                          </button>
                        ) : null}
                        {canMergeWithNext ? (
                          <button
                            type="button"
                            onClick={() => onMergeNodes!(parent!.id, node.id, nextNode!.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                            title="Combine machines"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                              />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title={
                            nextNode
                              ? "Add machine between or below"
                              : "Add machine below"
                          }
                          onClick={() =>
                            openAddSibling(isRootRow ? tree.children.length : childIdx + 1)
                          }
                          className={sliceAddBtn}
                        >
                          +
                        </button>
                      </SliceBranchShiftedChrome>
                    );
                  }

                  return pieces;
                })}
                  </SliceBranchReorderGroup>
                  );

                  return groupEl;
                  });
                })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating INPUT — overlay; column flex is only the machine stack above */}
              <div
                className={`pointer-events-auto absolute left-0 right-0 top-0 z-30 hidden flex-col overflow-visible border-b shadow-[0_4px_12px_rgba(0,0,0,0.35)] backdrop-blur-sm transition lg:flex ${
                  hasAnyRed ? "border-red-500/60 bg-red-950/90" : "border-zinc-800 bg-zinc-950/95"
                }`}
              >
                <div className="flex h-6 shrink-0 w-full items-center justify-center gap-1 text-xs text-zinc-500">
                  {hasMoreThanTwoLines ? (
                    <button
                      type="button"
                      onClick={() =>
                        setHeaderExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(sliceIdx)) next.delete(sliceIdx);
                          else next.add(sliceIdx);
                          return next;
                        })
                      }
                      className="flex items-center justify-center gap-1 transition hover:text-zinc-300"
                    >
                      <span>INPUT</span>
                      <svg className={`h-3 w-3 ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  ) : (
                    <span>INPUT</span>
                  )}
                </div>
                <div className="h-22 overflow-hidden px-2 py-2">
                  {hasMoreThanTwoLines && isExpanded ? (
                    <div className="h-full" aria-hidden />
                  ) : (
                    <div className={`flex h-full flex-col gap-1.5 overflow-hidden ${hasMoreThanTwoLines ? "max-h-full" : ""}`}>
                      {/* Factory imports — shown at top of slice 0 */}
                      {sliceIdx === 0 && factoryImports.map((imp) => (
                        <div
                          key={`import-${imp.itemKey}-${imp.fromFactoryName}`}
                          className="flex items-center gap-1 rounded-lg border border-sky-900/60 bg-sky-950/40 px-2 py-1.5 text-xs"
                        >
                          <svg className="h-3 w-3 shrink-0 text-sky-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16l4-4m0 0l4 4m-4-4v12M21 8l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span className="font-medium text-sky-300">
                            {formatRate(imp.ratePerMin)} {getItemName(imp.itemKey, "compact")}
                          </span>
                          <span className="ml-auto truncate text-sky-500/70">↓ {imp.fromFactoryName}</span>
                        </div>
                      ))}
                      {Array.from(inputsByItem.entries()).map(([itemKey, { rate, consumers }]) =>
                        consumers.length === 0 ? (
                          <div key={itemKey} className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                            <span className="font-medium text-amber-400">
                              {formatRate(rate)} {getItemName(itemKey, "compact")}
                            </span>
                          </div>
                        ) : (
                          <div key={`amt-${itemKey}`} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                            <span className="font-medium text-amber-400">
                              {formatRate(rate)} {getItemName(itemKey, "compact")}
                            </span>
                          </div>
                        )
                      )}
                      {inputsByItem.size === 0 && sliceIdx === 0 && factoryImports.length === 0 && (
                        <div className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-zinc-400">No input</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {hasMoreThanTwoLines && isExpanded && (
                  <div
                    className={`absolute left-0 right-0 top-8 z-50 flex max-h-[85vh] flex-col gap-1.5 overflow-y-auto border border-zinc-700 bg-zinc-900 p-2 shadow-xl ${
                      hasAnyRed ? "border-t-red-500/60" : "border-t-zinc-800"
                    }`}
                  >
                    {sliceIdx === 0 && factoryImports.map((imp) => (
                      <div
                        key={`import-exp-${imp.itemKey}-${imp.fromFactoryName}`}
                        className="flex items-center gap-1 rounded-lg border border-sky-900/60 bg-sky-950/40 px-2 py-1.5 text-xs"
                      >
                        <svg className="h-3 w-3 shrink-0 text-sky-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16l4-4m0 0l4 4m-4-4v12M21 8l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span className="font-medium text-sky-300">
                          {formatRate(imp.ratePerMin)} {getItemName(imp.itemKey, "compact")}
                        </span>
                        <span className="ml-auto truncate text-sky-500/70">↓ {imp.fromFactoryName}</span>
                      </div>
                    ))}
                    {Array.from(inputsByItem.entries()).map(([itemKey, { rate, consumers }]) =>
                      consumers.length === 0 ? (
                        <div key={itemKey} className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-amber-400">
                            {formatRate(rate)} {getItemName(itemKey, "compact")}
                          </span>
                        </div>
                      ) : (
                        <div key={`amt-ex-${itemKey}`} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-amber-400">
                            {formatRate(rate)} {getItemName(itemKey, "compact")}
                          </span>
                        </div>
                      )
                    )}
                    {inputsByItem.size === 0 && sliceIdx === 0 && factoryImports.length === 0 && (
                      <div className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                        <span className="font-medium text-zinc-400">No input</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {hasFloatingOutput && (
                <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-30 hidden flex-col overflow-visible border-t border-zinc-800 bg-zinc-950/95 shadow-[0_-4px_12px_rgba(0,0,0,0.35)] backdrop-blur-sm lg:flex">
                  <div className="flex h-6 shrink-0 w-full items-center justify-center gap-1 text-xs text-zinc-500">
                    {outputsByItem.size > 2 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOutputExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(sliceIdx)) next.delete(sliceIdx);
                            else next.add(sliceIdx);
                            return next;
                          })
                        }
                        className="flex items-center justify-center gap-1 transition hover:text-zinc-300"
                      >
                        <span>OUTPUT</span>
                        <svg className={`h-3 w-3 ${outputExpanded.has(sliceIdx) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    ) : (
                      <span>OUTPUT</span>
                    )}
                  </div>
                  <div className="relative h-22 overflow-hidden px-2 py-2">
                    {outputsByItem.size > 2 && outputExpanded.has(sliceIdx) ? (
                      <div className="h-full" aria-hidden />
                    ) : (
                      <div className={`flex h-full flex-col gap-1.5 overflow-hidden ${outputsByItem.size > 2 ? "max-h-full" : ""}`}>
                        {Array.from(outputsByItem.entries()).map(([itemKey, rate]) => (
                          <div key={itemKey} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                            <span className="font-medium text-amber-400">
                              {formatRate(rate)} {getItemName(itemKey, "compact")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                        {/* outputs footer: uses getFlowSlices depth for labels only when needed */}
                        {outputsByItem.size > 2 && outputExpanded.has(sliceIdx) && (
                      <div className="absolute bottom-0 left-0 right-0 z-50 flex min-h-22 max-h-[85vh] flex-col gap-1.5 overflow-y-auto border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                        <button
                          type="button"
                          onClick={() =>
                            setOutputExpanded((prev) => {
                              const next = new Set(prev);
                              next.delete(sliceIdx);
                              return next;
                            })
                          }
                          className="flex w-full items-center justify-center gap-1 py-0.5 text-xs text-zinc-500 transition hover:text-zinc-300"
                        >
                          <span>OUTPUT</span>
                          <svg className="h-3 w-3 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {Array.from(outputsByItem.entries()).map(([itemKey, rate]) => (
                          <div key={itemKey} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                            <span className="font-medium text-amber-400">
                              {formatRate(rate)} {getItemName(itemKey, "compact")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </SliceColumnSurface>
          </Fragment>
        );
      })}

      {addMachineOpen && addMachineParent && (
        <AddMachineModal
          title="Add machine"
          options={childOptions(addMachineParent, addMachineSliceIdx, addMachineAllPrevSlices ?? []).options}
          allOptions={addMachineOptionsFiltered ? getAllMachineOptions() : undefined}
          onSelect={(opt) => {
            const parent = addMachineParent!;
            const insertIndex = addMachineInsertIndex ?? parent.children.length;
            const inputEdges: InputEdge[] = [];
            const allPrev = addMachineAllPrevSlices ?? [];
            const parentProduces = parent?.node.outputItemKey;
            if (opt.recipeKey && allPrev.length > 0 && parent) {
              const inputs = getRecipeInputsPerMinute(opt.recipeKey);
              for (const inp of inputs) {
                if (parentProduces === inp.itemKey) continue;
                let producer: TreeNode | undefined;
                for (let s = allPrev.length - 1; s >= 0; s--) {
                  producer = allPrev[s]!.find((n) => n.node.outputItemKey === inp.itemKey);
                  if (producer) break;
                }
                if (producer) {
                  inputEdges.push({
                    itemKey: inp.itemKey,
                    producerId: producer.id,
                    beltKey: pickDefaultBelt(inp.perMinute, inp.itemKey),
                  });
                }
              }
            }
            onAddMachine(
              parent,
              opt,
              insertIndex,
              inputEdges.length > 0 ? inputEdges : undefined,
              addMachineSliceIdx
            );
            setAddMachineOpen(false);
          }}
          onClose={() => setAddMachineOpen(false)}
        />
      )}
    </div>
  );
}
