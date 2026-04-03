"use client";

import { Fragment, useState } from "react";
import { AddMachineModal } from "@/components/flow-chart/AddMachineModal";
import {
  BranchingConnector,
  BranchingConnectorHorizontal,
  HorizontalMultiBranchConnector,
} from "@/components/flow-chart/flowChartConnectors";
import { FlowNodeCard } from "@/components/flow-chart/FlowNodeCard";
import { InputFlowBadge } from "@/components/flow-chart/InputFlowBadge";
import { formatRate, getItemName } from "@/components/flow-chart/flowChartDisplay";
import type { TreeLevelProps } from "@/components/flow-chart/treeLevelTypes";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import { getChildDemandForParentOutput } from "@/lib/flowChartFlowRates";
import { getNodePowerDisplay } from "@/lib/flowChartPower";
import { EMPTY_FLOW_RELATED_IDS, findNode } from "@/lib/flowChartTree";
import { normalizeTransportForItem } from "@/lib/flowTransport";
import {
  getExtractorMachineOptionsFull,
  getMachineOptionsForInput,
} from "@/lib/chain";

export function TreeLevel({
  treeNode,
  tree,
  flowRates,
  machineOptions,
  parentOutputItemKey,
  parentId,
  onUpdateNode,
  onSelectNodeMachine,
  onAddMachine,
  onUpdateChildBelt,
  onMergeNodes,
  onSplitNode,
  incomingBeltKey,
  onUpdateBelt,
  onRemove,
  removeNode,
  onSetSeparateAction,
  flowFocusNodeId = null,
  flowFocusRelatedIds = EMPTY_FLOW_RELATED_IDS,
  onFlowNodeHoverEnter,
  onFlowNodeHoverLeave,
  onFlowNodePinToggle,
}: TreeLevelProps) {
  const node = treeNode.node;
  const children = treeNode.children;

  const [isOpen, setIsOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);

  const childOptions = getMachineOptionsForInput(node.outputItemKey);
  const allProducesOptions = node.isRaw
    ? getExtractorMachineOptionsFull()
    : parentOutputItemKey
      ? getMachineOptionsForInput(parentOutputItemKey)
      : [];
  const producesOptions = allProducesOptions.filter(
    (opt) => opt.buildingKey === node.buildingKey
  );
  const totalDemand = children.reduce(
    (s, c) => s + (c.node.inputPerMachine ?? 0) * c.node.count,
    0
  );
  const overCapacity = children.length > 0 && totalDemand > node.totalOutput;
  const underCapacity = children.length > 0 && totalDemand < node.totalOutput && node.totalOutput > 0;

  const fd = flowRates.get(treeNode.id);
  const hasBeltBadge = fd && "beltCapacity" in fd && onUpdateBelt;
  const flowDataForBelt = fd as FlowRateData | undefined;

  return (
    <div className="flex min-w-0 flex-col items-center ">
      <div className="flex flex-col items-center gap-4">
        {hasBeltBadge && flowDataForBelt && (
          <InputFlowBadge
            value={normalizeTransportForItem(parentOutputItemKey ?? "", incomingBeltKey)}
            onChange={onUpdateBelt}
            beltCapacity={flowDataForBelt.beltCapacity}
            receivesInput={flowDataForBelt.receivesInput}
            itemKey={parentOutputItemKey ?? ""}
            itemName={parentOutputItemKey ? getItemName(parentOutputItemKey, "compact") : ""}
          />
        )}
        <FlowNodeCard
            node={node}
            machineOptions={machineOptions}
            producesOptions={producesOptions}
            isOpen={isOpen}
            onToggleOpen={() => setIsOpen(!isOpen)}
            onUpdate={(u) => onUpdateNode(treeNode.id, u)}
            onSelectMachine={(opt) => onSelectNodeMachine(treeNode.id, opt)}
            onRemove={onRemove}
            onSeparate={
              onSplitNode && parentId != null && node.count > 1
                ? () => onSplitNode(parentId, treeNode.id)
                : undefined
            }
            totalDemand={totalDemand}
            childCount={children.length}
            flowData={flowRates.get(treeNode.id)}
            incomingBeltKey={incomingBeltKey ?? treeNode.incomingBeltKey}
            onSetSeparateAction={onSetSeparateAction}
            flowHighlightSelf={flowFocusNodeId === treeNode.id}
            flowHighlightRelated={flowFocusRelatedIds.has(treeNode.id)}
            onFlowHoverEnter={
              onFlowNodeHoverEnter ? () => onFlowNodeHoverEnter(treeNode.id) : undefined
            }
            onFlowHoverLeave={onFlowNodeHoverLeave}
            onFlowPinClick={
              onFlowNodePinToggle ? () => onFlowNodePinToggle(treeNode.id) : undefined
            }
          />
        {(() => {
          const power = getNodePowerDisplay(node, flowRates.get(treeNode.id));
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
        {(() => {
          const fdr = flowRates.get(treeNode.id);
          if (fdr && "maxOutput" in fdr) {
            const f = fdr as FlowRateData;
            const used = children.reduce(
              (s, c) => s + getChildDemandForParentOutput(c, node.outputItemKey),
              0
            );
            const produced = f.currentOutput;
            const pct = produced > 0 ? (used / produced) * 100 : 0;
            const isOverCapacity = used > produced && produced > 0;
            return (
              <div
                className={`mt-2 flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-center text-sm font-medium ${
                  f.utilization < 1 || isOverCapacity
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-zinc-800/90 text-zinc-300"
                }`}
              >
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Output</span>
                <span>
                  {formatRate(used)} used/{formatRate(produced)} prod
                  <span className="mx-1.5 text-zinc-500">·</span>
                  <span className="font-semibold">{formatRate(pct)}%</span>
                  <span className="ml-1 text-zinc-500">of capacity</span>
                </span>
              </div>
            );
          }
          return null;
        })()}

        {childOptions.length > 0 && (
          <>
            {children.length === 0 ? (
              <>
                <BranchingConnector branchCount={1} />
                <button
                  type="button"
                  onClick={() => setAddMachineOpen(true)}
                  className={`
                    flex min-h-[120px] min-w-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition
                    ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                  `}
                >
                  <span className="text-3xl font-light text-zinc-400">+</span>
                  <span className="text-center text-sm font-medium text-zinc-400">Add machine</span>
                </button>
              </>
            ) : (
              <>
                <div className="flex min-w-0 w-full flex-col items-center ">
                  <div className="h-4 w-px bg-zinc-600" />
                  <div className="h-px w-full bg-zinc-600" style={{ minWidth: "120px" }} />
                  <div className="flex min-w-0 w-full flex-nowrap justify-center gap-4 overflow-x-auto  pb-2">
                    {children.map((child, idx) => (
                      <Fragment key={child.id}>
                        {idx > 0 &&
                          onMergeNodes &&
                          (() => {
                            const left = children[idx - 1];
                            const canMerge =
                              left.node.outputItemKey && child.node.outputItemKey &&
                              left.node.outputItemKey === child.node.outputItemKey;
                            return canMerge ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMergeNodes(treeNode.id, left.id, child.id);
                                }}
                                className="flex shrink-0 flex-col items-center justify-center gap-1 self-center rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-amber-400"
                                title="Connect (merge)"
                              >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                <span className="text-[10px]">link</span>
                              </button>
                            ) : null;
                          })()}
                        <div className="flex shrink-0 flex-col items-center">
                        <div className="h-4 w-px bg-zinc-600" />
                        <svg className="h-5 w-5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        {children.length > 1 && (
                          <div className="mb-1 mt-1 text-xs text-zinc-500">
                            {formatRate((child.node.inputPerMachine ?? 0) * child.node.count)}/min
                          </div>
                        )}
                        <TreeLevel
                          treeNode={child}
                          tree={tree}
                          flowRates={flowRates}
                          machineOptions={getMachineOptionsForInput(treeNode.node.outputItemKey)}
                          parentOutputItemKey={treeNode.node.outputItemKey}
                          parentId={treeNode.id}
                          onUpdateNode={onUpdateNode}
                          onSelectNodeMachine={onSelectNodeMachine}
                          onAddMachine={onAddMachine}
                          onUpdateChildBelt={onUpdateChildBelt}
                          onMergeNodes={onMergeNodes}
                          onSplitNode={onSplitNode}
                          incomingBeltKey={child.incomingBeltKey}
                          onUpdateBelt={(key) => onUpdateChildBelt(treeNode.id, child.id, key)}
                          onRemove={() => removeNode(treeNode.id, child.id)}
                          removeNode={removeNode}
                          onSetSeparateAction={onSetSeparateAction}
                          flowFocusNodeId={flowFocusNodeId}
                          flowFocusRelatedIds={flowFocusRelatedIds}
                          onFlowNodeHoverEnter={onFlowNodeHoverEnter}
                          onFlowNodeHoverLeave={onFlowNodeHoverLeave}
                          onFlowNodePinToggle={onFlowNodePinToggle}
                        />
                        </div>
                      </Fragment>
                    ))}
                    <div className="flex shrink-0 flex-col items-center">
                      <div className="h-4 w-px bg-zinc-600" />
                      <svg className="h-5 w-5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                      <button
                        type="button"
                        onClick={() => setAddMachineOpen(true)}
                        className={`
                          mt-4 flex min-h-[100px] min-w-[100px] flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition
                          ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                        `}
                      >
                        <span className="text-2xl font-light text-zinc-400">+</span>
                        <span className="text-center text-xs font-medium text-zinc-400">Add machine</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {addMachineOpen && (
          <AddMachineModal
            title="Add machine"
            options={childOptions}
            onSelect={(opt) => {
              onAddMachine(treeNode, opt);
              setAddMachineOpen(false);
            }}
            onClose={() => setAddMachineOpen(false)}
          />
        )}
      </div>

      {overCapacity && (
        <p className="mt-2 text-sm text-amber-400">
          Over capacity: needs {formatRate(totalDemand)}/min, supplying {formatRate(node.totalOutput)}/min
        </p>
      )}
      {underCapacity && (
        <p className="mt-2 text-sm text-zinc-500">
          Over-supplying: {formatRate(node.totalOutput)}/min available, {formatRate(totalDemand)}/min used
        </p>
      )}
    </div>
  );
}

export function TreeLevelHorizontal(props: TreeLevelProps) {
  const {
    treeNode,
    tree,
    flowRates,
    machineOptions,
    parentOutputItemKey,
    parentId,
    onUpdateNode,
    onSelectNodeMachine,
    onAddMachine,
    onUpdateChildBelt,
    onMergeNodes,
    onSplitNode,
    incomingBeltKey,
    onUpdateBelt,
    onRemove,
    removeNode,
    onSetSeparateAction,
    compactSlice = false,
    flowFocusNodeId = null,
    flowFocusRelatedIds = EMPTY_FLOW_RELATED_IDS,
    onFlowNodeHoverEnter,
    onFlowNodeHoverLeave,
    onFlowNodePinToggle,
  } = props;
  const node = treeNode.node;
  const children = treeNode.children;
  const parent = parentId ? findNode(tree, parentId) : null;
  const siblingIndex = parent ? parent.children.findIndex((c) => c.id === treeNode.id) : -1;

  const [isOpen, setIsOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [addMachineInsertIndex, setAddMachineInsertIndex] = useState<number | null>(null);

  const childOptions = getMachineOptionsForInput(node.outputItemKey);
  const allProducesOptions = node.isRaw
    ? getExtractorMachineOptionsFull()
    : parentOutputItemKey
      ? getMachineOptionsForInput(parentOutputItemKey)
      : [];
  const producesOptions = allProducesOptions.filter(
    (opt) => opt.buildingKey === node.buildingKey
  );
  const totalDemand = children.reduce(
    (s, c) => s + (c.node.inputPerMachine ?? 0) * c.node.count,
    0
  );
  const overCapacity = children.length > 0 && totalDemand > node.totalOutput;
  const underCapacity = children.length > 0 && totalDemand < node.totalOutput && node.totalOutput > 0;

  const fd = flowRates.get(treeNode.id);
  const hasBeltBadge = fd && "beltCapacity" in fd && onUpdateBelt;
  const flowDataForBelt = fd as FlowRateData | undefined;

  const outputBadge = (() => {
    const fdr = flowRates.get(treeNode.id);
    if (fdr && "maxOutput" in fdr) {
      const f = fdr as FlowRateData;
      const used = children.reduce(
        (s, c) => s + getChildDemandForParentOutput(c, node.outputItemKey),
        0
      );
      const produced = f.currentOutput;
      const pct = produced > 0 ? (used / produced) * 100 : 0;
      const isOverCapacity = used > produced && produced > 0;
      return (
        <div
          className={`flex items-center justify-center gap-1.5 rounded px-2 py-1 text-center text-xs font-medium ${
            f.utilization < 1 || isOverCapacity
              ? "bg-amber-500/20 text-amber-300"
              : "bg-zinc-800/90 text-zinc-300"
          }`}
        >
          <span>{formatRate(used)}/{formatRate(produced)}</span>
          <span className="text-zinc-500">·</span>
          <span className="font-semibold">{formatRate(pct)}%</span>
        </div>
      );
    }
    return null;
  })();

  const isChildSection = parentOutputItemKey != null;
  const cardOnly = (
    <div className="flex min-w-[200px] w-[200px] shrink-0 flex-col items-center justify-center">
      <FlowNodeCard
        node={node}
        machineOptions={machineOptions}
        producesOptions={producesOptions}
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen(!isOpen)}
        onUpdate={(u) => onUpdateNode(treeNode.id, u)}
        onSelectMachine={(opt) => onSelectNodeMachine(treeNode.id, opt)}
        onRemove={onRemove}
        onSeparate={
          onSplitNode && parentId != null && node.count > 1
            ? () => onSplitNode(parentId, treeNode.id)
            : undefined
        }
        totalDemand={totalDemand}
        childCount={children.length}
        flowData={flowRates.get(treeNode.id)}
        incomingBeltKey={incomingBeltKey ?? treeNode.incomingBeltKey}
        fixedWidth
        onSetSeparateAction={onSetSeparateAction}
        flowHighlightSelf={flowFocusNodeId === treeNode.id}
        flowHighlightRelated={flowFocusRelatedIds.has(treeNode.id)}
        onFlowHoverEnter={
          onFlowNodeHoverEnter ? () => onFlowNodeHoverEnter(treeNode.id) : undefined
        }
        onFlowHoverLeave={onFlowNodeHoverLeave}
        onFlowPinClick={
          onFlowNodePinToggle ? () => onFlowNodePinToggle(treeNode.id) : undefined
        }
      />
      {(() => {
        const power = getNodePowerDisplay(node, flowRates.get(treeNode.id));
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
  );

  const nodeBlock = (
    <div className="flex min-w-[200px] w-[200px] shrink-0 flex-col items-stretch gap-2">
      {cardOnly}
      {outputBadge}
    </div>
  );

  const addButton = parent && childOptions.length > 0 && !compactSlice;
  const sliceBody = (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-3">
      {addButton && (
        <button
          type="button"
          onClick={() => {
            setAddMachineInsertIndex(siblingIndex >= 0 ? siblingIndex : 0);
            setAddMachineOpen(true);
          }}
          className={`
            flex aspect-square h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 transition
            ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
          `}
        >
          <span className="text-xl font-light text-zinc-400">+</span>
        </button>
      )}
      {cardOnly}
      {addButton && (
        <button
          type="button"
          onClick={() => {
            setAddMachineInsertIndex(siblingIndex >= 0 ? siblingIndex + 1 : 0);
            setAddMachineOpen(true);
          }}
          className={`
            flex aspect-square h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 transition
            ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
          `}
        >
          <span className="text-xl font-light text-zinc-400">+</span>
        </button>
      )}
    </div>
  );

  const sliceContainer = (
    <div className="relative flex min-w-[248px] w-[248px] min-h-0 flex-1 shrink-0 flex-col pl-6 pr-6 before:absolute before:left-0 before:top-[-100dvh] before:h-[300dvh] before:border-l-2 before:border-dashed before:border-zinc-600 before:content-[''] after:absolute after:right-0 after:top-[-100dvh] after:h-[300dvh] after:border-r-2 after:border-dashed after:border-zinc-600 after:content-['']">
      {!compactSlice && hasBeltBadge && flowDataForBelt && (
        <div className="flex min-w-[200px] w-[200px] shrink-0 justify-center border-b border-zinc-800 py-3">
          <InputFlowBadge
            value={normalizeTransportForItem(parentOutputItemKey!, incomingBeltKey)}
            onChange={onUpdateBelt!}
            beltCapacity={flowDataForBelt.beltCapacity}
            receivesInput={flowDataForBelt.receivesInput}
            itemKey={parentOutputItemKey!}
            itemName={getItemName(parentOutputItemKey!, "compact")}
            compact
            fullWidth
          />
        </div>
      )}
      {sliceBody}
      {!compactSlice && outputBadge && (
        <div className="flex min-w-[200px] w-[200px] shrink-0 justify-center border-t border-zinc-800 py-3">
          {outputBadge}
        </div>
      )}
    </div>
  );

  const wrappedNode = isChildSection ? (
    compactSlice ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-3">
        {cardOnly}
      </div>
    ) : (
      sliceContainer
    )
  ) : (
    nodeBlock
  );

  return (
    <div className="flex min-h-0 flex-1 shrink-0 flex-row items-stretch gap-2">
      <div className={isChildSection ? "flex min-h-0 flex-1" : "flex min-h-full flex-1 items-center justify-center"}>
        {wrappedNode}
      </div>

      {/* Connector + Children or Add */}
      {childOptions.length > 0 && (
        <>
          {children.length === 0 ? (
            <div className="flex flex-row items-center gap-2">
              <BranchingConnectorHorizontal />
              <button
                type="button"
                onClick={() => setAddMachineOpen(true)}
                className={`
                  flex min-h-[120px] min-w-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition
                  ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                `}
              >
                <span className="text-3xl font-light text-zinc-400">+</span>
                <span className="text-center text-sm font-medium text-zinc-400">Add machine</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-row items-start gap-0">
              {children.length === 1 ? (
                <div className="flex min-h-full flex-1 flex-row items-stretch">
                  <BranchingConnectorHorizontal />
                  <TreeLevelHorizontal
                    treeNode={children[0]}
                    tree={tree}
                    flowRates={flowRates}
                    machineOptions={getMachineOptionsForInput(node.outputItemKey)}
                    parentOutputItemKey={node.outputItemKey}
                    parentId={treeNode.id}
                    onUpdateNode={onUpdateNode}
                    onSelectNodeMachine={onSelectNodeMachine}
                    onAddMachine={onAddMachine}
                    onUpdateChildBelt={onUpdateChildBelt}
                    onMergeNodes={onMergeNodes}
                    onSplitNode={onSplitNode}
                    incomingBeltKey={children[0].incomingBeltKey}
                    onUpdateBelt={(key) => onUpdateChildBelt(treeNode.id, children[0].id, key)}
                    onRemove={() => removeNode(treeNode.id, children[0].id)}
                    removeNode={removeNode}
                    onSetSeparateAction={onSetSeparateAction}
                    flowFocusNodeId={flowFocusNodeId}
                    flowFocusRelatedIds={flowFocusRelatedIds}
                    onFlowNodeHoverEnter={onFlowNodeHoverEnter}
                    onFlowNodeHoverLeave={onFlowNodeHoverLeave}
                    onFlowNodePinToggle={onFlowNodePinToggle}
                  />
                  <BranchingConnectorHorizontal />
                  <button
                    type="button"
                    onClick={() => setAddMachineOpen(true)}
                    className={`
                      flex min-h-[80px] min-w-[80px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 transition
                      ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                    `}
                  >
                    <span className="text-xl font-light text-zinc-400">+</span>
                    <span className="text-center text-xs font-medium text-zinc-400">Add</span>
                  </button>
                </div>
              ) : (
                <>
                  <HorizontalMultiBranchConnector childCount={children.length + 1} />
                  <div className="relative flex min-h-full min-w-[248px] w-[248px] flex-1 flex-col items-stretch pl-6 pr-6 before:absolute before:left-0 before:top-[-100dvh] before:h-[300dvh] before:border-l-2 before:border-dashed before:border-zinc-600 before:content-[''] after:absolute after:right-0 after:top-[-100dvh] after:h-[300dvh] after:border-r-2 after:border-dashed after:border-zinc-600 after:content-['']">
                    {/* Summed header: total belt input for all children */}
                    {(() => {
                      const summedReceives = children.reduce(
                        (s, c) => s + ((flowRates.get(c.id) as FlowRateData | undefined)?.receivesInput ?? 0),
                        0
                      );
                      const maxBeltCapacity = Math.max(
                        ...children.map((c) => (flowRates.get(c.id) as FlowRateData | undefined)?.beltCapacity ?? 0),
                        0
                      );
                      const hasAnyBelt = children.some((c) => flowRates.get(c.id) && "beltCapacity" in (flowRates.get(c.id) ?? {}));
                      if (!hasAnyBelt) return null;
                      return (
                        <div className="flex min-w-[200px] w-[200px] shrink-0 justify-center border-b border-zinc-800 py-3">
                          <InputFlowBadge
                            value={normalizeTransportForItem(node.outputItemKey, children[0]?.incomingBeltKey)}
                            onChange={() => {}}
                            beltCapacity={maxBeltCapacity}
                            receivesInput={summedReceives}
                            itemKey={node.outputItemKey}
                            itemName={getItemName(node.outputItemKey, "compact")}
                            compact
                            fullWidth
                            readOnly
                          />
                        </div>
                      );
                    })()}
                    {children.flatMap((child, i) => [
                      <div key={child.id} className="flex min-h-0 flex-1 flex-row items-stretch">
                        <TreeLevelHorizontal
                          treeNode={child}
                          tree={tree}
                          flowRates={flowRates}
                          machineOptions={getMachineOptionsForInput(node.outputItemKey)}
                          parentOutputItemKey={node.outputItemKey}
                          parentId={treeNode.id}
                          onUpdateNode={onUpdateNode}
                          onSelectNodeMachine={onSelectNodeMachine}
                          onAddMachine={onAddMachine}
                          onUpdateChildBelt={onUpdateChildBelt}
                          onMergeNodes={onMergeNodes}
                          onSplitNode={onSplitNode}
                          incomingBeltKey={child.incomingBeltKey}
                          onUpdateBelt={(key) => onUpdateChildBelt(treeNode.id, child.id, key)}
                          onRemove={() => removeNode(treeNode.id, child.id)}
                          removeNode={removeNode}
                          onSetSeparateAction={onSetSeparateAction}
                          compactSlice
                          flowFocusNodeId={flowFocusNodeId}
                          flowFocusRelatedIds={flowFocusRelatedIds}
                          onFlowNodeHoverEnter={onFlowNodeHoverEnter}
                          onFlowNodeHoverLeave={onFlowNodeHoverLeave}
                          onFlowNodePinToggle={onFlowNodePinToggle}
                        />
                      </div>,
                      i < children.length - 1 ? (
                        <button
                          key={`add-${child.id}`}
                          type="button"
                          onClick={() => {
                            setAddMachineInsertIndex(i + 1);
                            setAddMachineOpen(true);
                          }}
                          className={`
                            flex aspect-square h-10 w-10 shrink-0 items-center justify-center self-center rounded-lg border-2 transition
                            ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                          `}
                        >
                          <span className="text-xl font-light text-zinc-400">+</span>
                        </button>
                      ) : null,
                    ].filter(Boolean))}
                    {/* Summed footer: total output used/produced for all children */}
                    {(() => {
                      const summedUsed = children.reduce(
                        (s, c) =>
                          s +
                          c.children.reduce(
                            (ss, gc) => ss + getChildDemandForParentOutput(gc, c.node.outputItemKey),
                            0
                          ),
                        0
                      );
                      const summedProduced = children.reduce(
                        (s, c) => {
                          const f = flowRates.get(c.id) as FlowRateData | undefined;
                          return s + (f && "currentOutput" in f ? f.currentOutput : 0);
                        },
                        0
                      );
                      const pct = summedProduced > 0 ? (summedUsed / summedProduced) * 100 : 0;
                      const isOverCapacity = summedUsed > summedProduced && summedProduced > 0;
                      const anyOutput = children.some((c) => {
                        const f = flowRates.get(c.id);
                        return f && "maxOutput" in (f ?? {});
                      });
                      if (!anyOutput) return null;
                      return (
                        <div className="flex min-w-[200px] w-[200px] shrink-0 justify-center border-t border-zinc-800 py-3">
                          <div
                            className={`flex items-center justify-center gap-1.5 rounded px-2 py-1 text-center text-xs font-medium ${
                              isOverCapacity
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-zinc-800/90 text-zinc-300"
                            }`}
                          >
                            <span>{formatRate(summedUsed)}/{formatRate(summedProduced)}</span>
                            <span className="text-zinc-500">·</span>
                            <span className="font-semibold">{formatRate(pct)}%</span>
                          </div>
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => setAddMachineOpen(true)}
                      className={`
                        flex min-h-[80px] min-w-[80px] shrink-0 flex-col items-center justify-center gap-1 self-start rounded-xl border-2 p-3 transition
                        ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}
                      `}
                    >
                      <span className="text-xl font-light text-zinc-400">+</span>
                      <span className="text-center text-xs font-medium text-zinc-400">Add</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {addMachineOpen && (
        <AddMachineModal
          title="Add machine"
          options={childOptions}
          onSelect={(opt) => {
            const targetParent = addMachineInsertIndex != null && parent ? parent : treeNode;
            onAddMachine(targetParent, opt, addMachineInsertIndex ?? undefined);
            setAddMachineOpen(false);
            setAddMachineInsertIndex(null);
          }}
          onClose={() => {
            setAddMachineOpen(false);
            setAddMachineInsertIndex(null);
          }}
        />
      )}

      {(overCapacity || underCapacity) && (
        <div className="shrink-0 text-sm">
          {overCapacity && (
            <p className="text-amber-400">
              Over capacity: needs {formatRate(totalDemand)}/min, supplying {formatRate(node.totalOutput)}/min
            </p>
          )}
          {underCapacity && (
            <p className="text-zinc-500">
              Over-supplying: {formatRate(node.totalOutput)}/min available, {formatRate(totalDemand)}/min used
            </p>
          )}
        </div>
      )}
    </div>
  );
}
