"use client";

import { Fragment, useState } from "react";
import type { ItemDisplayDensity } from "@/lib/itemDisplayName";
import {
  abbreviateItemDisplayName,
  formatRate,
  getInputSlots,
  getItemName,
} from "@/components/flow-chart/flowChartDisplay";
import { ConfirmModal } from "@/components/flow-chart/ConfirmModal";
import { DraggablePercent } from "@/components/flow-chart/DraggablePercent";
import { EditNodeModal } from "@/components/flow-chart/EditNodeModal";
import { MachineClocksModal } from "@/components/flow-chart/MachineClocksModal";
import { flowHoverHighlightClass } from "@/components/flow-chart/flowChartFlowHover";
import type { FlowInputData, FlowRateData } from "@/lib/flowChartFlowTypes";
import {
  getAverageClockPercent,
  totalPowerShardsForNode,
  type FlowNode,
} from "@/lib/flowChartModel";
import { sortOptionsNonAltFirst } from "@/lib/chain";
import type { MachineOption } from "@/components/flow-chart/flowChartTypes";

export interface FlowNodeCardProps {
  node: FlowNode;
  machineOptions: MachineOption[];
  producesOptions: MachineOption[];
  isOpen: boolean;
  onToggleOpen: () => void;
  onUpdate: (u: Partial<FlowNode>) => void;
  onSelectMachine: (opt: MachineOption) => void;
  onRemove?: () => void;
  onSeparate?: () => void;
  onSetSeparateAction?: (action: (() => void) | null) => void;
  totalDemand?: number;
  childCount?: number;
  flowData?: FlowRateData | { parentSending: number };
  /** Belt from parent into this machine (for details modal). */
  incomingBeltKey?: string;
  compact?: boolean;
  fixedWidth?: boolean;
  flowHighlightSelf?: boolean;
  flowHighlightRelated?: boolean;
  onFlowHoverEnter?: () => void;
  onFlowHoverLeave?: () => void;
  /** Pin upstream branch highlight (toggle) */
  onFlowPinClick?: () => void;
  /** Break out machine at index from per-machine clock modal */
  onBreakOut?: (machineIndex: number) => void;
}

export function FlowNodeCard({
  node,
  machineOptions,
  producesOptions,
  isOpen,
  onToggleOpen,
  onUpdate,
  onSelectMachine,
  onRemove,
  onSeparate,
  onSetSeparateAction,
  totalDemand = 0,
  childCount = 0,
  flowData,
  incomingBeltKey,
  onBreakOut,
  compact: compactProp = true,
  fixedWidth = false,
  flowHighlightSelf = false,
  flowHighlightRelated = false,
  onFlowHoverEnter,
  onFlowHoverLeave,
  onFlowPinClick,
}: FlowNodeCardProps) {
  const widthClass = fixedWidth ? "min-w-[200px] w-[200px] shrink-0" : "w-fit shrink-0";
  const sortedProduces = sortOptionsNonAltFirst(producesOptions);
  const sortedMachine = sortOptionsNonAltFirst(machineOptions);
  const [isCompact, setIsCompact] = useState(compactProp);
  const [producesOpen, setProducesOpen] = useState(false);
  const [producesModalOpen, setProducesModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [machinesModalOpen, setMachinesModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const allocatedInput = (node.inputPerMachine ?? 0) * node.count;
  const hasFullFlowData = flowData && "beltCapacity" in flowData;
  const flowOutputs =
    hasFullFlowData && "outputs" in (flowData as FlowRateData)
      ? ((flowData as FlowRateData).outputs ?? [])
      : [];
  const byproductOutputs = flowOutputs.filter((o) => !o.isPrimary);
  const isUnderfed =
    flowData &&
    "utilization" in flowData &&
    (flowData as FlowRateData).utilization < 1;

  const nameDensity: ItemDisplayDensity = isCompact ? "compact" : "comfortable";
  const displayProductName = getItemName(node.outputItemKey, nameDensity);
  const recipeNameAbbrev = node.recipeName ? abbreviateItemDisplayName(node.recipeName, nameDensity) : "";
  const showRecipeSubtitle = Boolean(recipeNameAbbrev && recipeNameAbbrev !== displayProductName);

  const totalPowerShards = totalPowerShardsForNode(node);
  const SHARD_DOT_CAP = 8;
  const shardDotsToRender = Math.min(totalPowerShards, SHARD_DOT_CAP);
  const shardDotsOverflow = totalPowerShards > SHARD_DOT_CAP ? totalPowerShards - SHARD_DOT_CAP : 0;
  const shardTitle =
    totalPowerShards > 0
      ? `${totalPowerShards} power shard${totalPowerShards !== 1 ? "s" : ""} total (${node.count} machine${node.count !== 1 ? "s" : ""}; per-machine clocks in grid)`
      : "";

  const compactView = (
    <div
      data-flow-node-card
      onClick={() => {
        onSetSeparateAction?.(onSeparate ?? null);
        onFlowPinClick?.();
      }}
      onMouseEnter={onFlowHoverEnter}
      onMouseLeave={onFlowHoverLeave}
      className={`
        select-none flex flex-col gap-1 rounded-lg border-2 bg-zinc-900/90 px-3 py-2 shadow transition-all
        hover:border-zinc-600
        ${widthClass}
        ${flowHoverHighlightClass(flowHighlightSelf, flowHighlightRelated)}
        ${isOpen ? "border-amber-500/60" : isUnderfed ? "border-amber-500/50 bg-amber-900/30!" : "border-zinc-800"}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-zinc-100">
          {node.count} {node.buildingName}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {totalPowerShards > 0 && (
            <div
              className="flex max-w-13 shrink-0 flex-wrap justify-end gap-0.5 pt-px"
              title={shardTitle}
              aria-label={`${totalPowerShards} power shards`}
            >
              {Array.from({ length: shardDotsToRender }, (_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_3px_rgba(56,189,248,0.55)]"
                  aria-hidden
                />
              ))}
              {shardDotsOverflow > 0 && (
                <span className="text-[9px] font-semibold leading-none text-sky-400">+{shardDotsOverflow}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        {producesOptions.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (node.isRaw) {
                setProducesModalOpen(true);
              } else {
                setEditModalOpen(true);
              }
            }}
            className="min-w-0 truncate text-left text-base font-semibold text-teal-300 transition hover:text-teal-200 hover:underline"
            title={`${displayProductName} – Change product`}
          >
            {displayProductName}
          </button>
        ) : (
          <span className="min-w-0 truncate text-base font-semibold text-teal-300" title={displayProductName}>
            {displayProductName}
          </span>
        )}
        <span
          className={`shrink-0 font-mono ${
            hasFullFlowData && "currentOutput" in flowData
              ? (flowData as FlowRateData).currentOutput >= (flowData as FlowRateData).maxOutput - 0.5
                ? "text-green-400"
                : "text-zinc-100"
              : "text-zinc-100"
          }`}
        >
          {hasFullFlowData && "currentOutput" in flowData
            ? `${formatRate((flowData as FlowRateData).currentOutput)}/${formatRate((flowData as FlowRateData).maxOutput)}/min`
            : `${formatRate(node.totalOutput)}/min`}
        </span>
      </div>
      {hasFullFlowData && byproductOutputs.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs font-mono">
          {byproductOutputs.map((out) => (
            <div key={out.itemKey} className="flex justify-between">
              <span className="text-sky-400">{getItemName(out.itemKey, nameDensity)}</span>
              <span className="text-sky-300">
                {formatRate(out.currentOutput)}/{formatRate(out.maxOutput)}/min
              </span>
            </div>
          ))}
        </div>
      )}
      {hasFullFlowData && (flowData as FlowRateData).inputs && (flowData as FlowRateData).inputs!.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs">
          {(flowData as FlowRateData).inputs!.map((r) => {
            const isBottlenecked = r.receivesInput < r.needsInput - 0.5;
            const inputLineLabel = getItemName(r.itemKey, nameDensity);
            return (
              <div key={r.itemKey} className="flex justify-between font-mono">
                <span className={isBottlenecked ? "text-amber-400" : "text-zinc-500"}>{inputLineLabel}</span>
                <span className={isBottlenecked ? "text-amber-400" : "text-zinc-300"}>
                  {formatRate(r.receivesInput)}/{formatRate(r.needsInput)}/min
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (node.count > 1) {
                onUpdate({ count: node.count - 1 });
              } else if (onRemove) {
                setDeleteConfirmOpen(true);
              }
            }}
            className={`rounded p-1 transition ${
              node.count === 1 && onRemove
                ? "text-red-400 hover:bg-red-900/40 hover:text-red-300"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            title={node.count === 1 && onRemove ? "Delete machine" : "Decrease count"}
          >
            {node.count === 1 && onRemove ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : (
              "−"
            )}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdate({ count: node.count + 1 }); }}
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Increase count"
          >
            +
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditModalOpen(true); }}
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-teal-400"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMachinesModalOpen(true);
            }}
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Per-machine clock (grid)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
          </button>
        </div>
        <DraggablePercent
          value={getAverageClockPercent(node)}
          onChange={(v) => onUpdate({ clockPercent: v })}
          className="shrink-0 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          title="Average clock — set all machines the same (clears per-machine tweaks)"
        />
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <>
        {compactView}
        {machinesModalOpen && (
          <MachineClocksModal
            node={node}
            onClose={() => setMachinesModalOpen(false)}
            onUpdate={(u) => {
              onUpdate(u);
            }}
            onBreakOut={onBreakOut}
          />
        )}
        {editModalOpen && (
          <EditNodeModal
            node={node}
            machineOptions={sortedMachine}
            producesOptions={sortedProduces}
            onUpdate={onUpdate}
            onSelectMachine={(opt) => { onSelectMachine(opt); setEditModalOpen(false); }}
            onClose={() => setEditModalOpen(false)}
            onRemove={onRemove ? () => { onRemove(); setEditModalOpen(false); } : undefined}
            flowData={flowData}
            totalDemand={totalDemand}
            childCount={childCount}
            incomingBeltKey={incomingBeltKey}
          />
        )}
        {node.isRaw && producesModalOpen && producesOptions.length > 0 && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setProducesModalOpen(false)}
          >
            <div
              className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
                <h2 className="text-xl font-semibold text-zinc-100">Select resource</h2>
                <button
                  type="button"
                  onClick={() => setProducesModalOpen(false)}
                  className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-6">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                  {sortedProduces.map((opt) => (
                    <button
                      key={opt.recipeKey}
                      type="button"
                      onClick={() => {
                        onSelectMachine(opt);
                        setProducesModalOpen(false);
                      }}
                      className={`rounded-lg border-2 px-3 py-2.5 text-left transition ${
                        node.outputItemKey === opt.outputItemKey && node.buildingKey === opt.buildingKey
                          ? "border-amber-500/60 bg-amber-600/20 text-amber-300"
                          : "border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-amber-500/50 hover:bg-zinc-800"
                      }`}
                    >
                      <div className="text-sm font-medium">{getItemName(opt.outputItemKey)}</div>
                      <div className="text-xs text-zinc-500">
                        {formatRate(opt.outputPerMachine)}/min
                      </div>
                      {getInputSlots(opt.buildingKey) > 0 && (
                        <div className="mt-0.5 text-xs text-zinc-500">{getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <ConfirmModal
          open={deleteConfirmOpen}
          title="Delete machine?"
          message="This machine node will be removed from the factory."
          confirmLabel="Delete machine"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={() => {
            setDeleteConfirmOpen(false);
            onRemove?.();
          }}
        />
      </>
    );
  }

  return (
    <>
    <div
      data-flow-node-card
      onClick={() => {
        onSetSeparateAction?.(onSeparate ?? null);
        onFlowPinClick?.();
      }}
      onMouseEnter={onFlowHoverEnter}
      onMouseLeave={onFlowHoverLeave}
      className={`
        select-none flex flex-col gap-3 rounded-xl border-2 bg-zinc-900/90 p-4 shadow-lg transition-all
        hover:border-zinc-600
        ${widthClass}
        ${flowHoverHighlightClass(flowHighlightSelf, flowHighlightRelated)}
        ${isOpen ? "border-amber-500/60 ring-2 ring-amber-500/20" : isUnderfed ? "border-amber-500/50 bg-amber-900/30!" : "border-zinc-800"}
      `}
    >
      <div className="min-w-0">
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex-1">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100">{node.count} {node.buildingName}</span>
            </div>
              {producesOptions.length > 0 ? (
                <div className="mt-0.5 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.isRaw) {
                        setProducesModalOpen(true);
                      } else {
                        setProducesOpen(!producesOpen);
                      }
                    }}
                    className="w-full text-left text-base font-semibold text-teal-300 transition hover:text-teal-200"
                  >
                    {displayProductName}
                    {showRecipeSubtitle && (
                      <span className="ml-1 text-sm text-zinc-500">({recipeNameAbbrev})</span>
                    )}
                    <span className="ml-1 text-xs text-zinc-500">▼</span>
                  </button>
                  {node.isRaw && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const order: Array<"impure" | "normal" | "pure"> = ["impure", "normal", "pure"];
                        const current = node.nodePurity ?? "normal";
                        const idx = order.indexOf(current);
                        const next = order[(idx + 1) % order.length];
                        onUpdate({ nodePurity: next });
                      }}
                      className="w-fit rounded border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-xs capitalize text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                      title={(node.nodePurity ?? "normal") === "impure" ? "0.5× output (click to change)" : (node.nodePurity ?? "normal") === "pure" ? "2× output (click to change)" : "1× output (click to change)"}
                    >
                      {node.nodePurity ?? "normal"}
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-0.5 text-sm font-semibold text-teal-300">{displayProductName}</div>
              )}
            </div>
          </div>
        </div>

        {producesOptions.length > 0 && !node.isRaw && producesOpen && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border-2 border-zinc-700 bg-zinc-900 p-2 shadow-xl">
            {sortedProduces.map((opt) => (
              <button
                key={opt.recipeKey}
                type="button"
                onClick={() => {
                  onSelectMachine(opt);
                  setProducesOpen(false);
                }}
                className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm last:mb-0 ${
                  node.recipeKey === opt.recipeKey
                    ? "bg-amber-600/30 text-amber-300"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                <span className="font-medium">{opt.recipeName}</span>
                <span className="ml-2 text-zinc-500">
                  {formatRate(opt.outputPerMachine)}/min
                </span>
                {getInputSlots(opt.buildingKey) > 0 && (
                  <span className="ml-2 text-xs text-zinc-500">· {getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2 border-b border-zinc-800 pb-3">
        <div
          className="flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <DraggablePercent
            value={getAverageClockPercent(node)}
            onChange={(v) => onUpdate({ clockPercent: v })}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-center text-xs text-zinc-100"
            title="Average clock — set all machines the same (clears per-machine tweaks)"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMachinesModalOpen(true);
            }}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            title="Per-machine clock grid"
          >
            Machines…
          </button>
        </div>
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {node.isRaw ? "Output" : "Input"}
        </div>
        {hasFullFlowData ? (
          (() => {
            const f = flowData as FlowRateData;
            const rows: (FlowInputData | { itemName: string; needsInput: number; receivesInput: number })[] =
              f.inputs && f.inputs.length > 0
                ? f.inputs
                : [{ itemName: "Input", needsInput: f.needsInput, receivesInput: f.receivesInput }];
            return (
              <div className="space-y-1.5 text-sm font-mono">
                {rows.map((r) => {
                  const isBottlenecked = r.receivesInput < r.needsInput;
                  const missing = r.needsInput - r.receivesInput;
                  const inputLabel =
                    "itemKey" in r && r.itemKey
                      ? getItemName(r.itemKey, "comfortable")
                      : r.itemName;
                  return (
                    <div key={"itemKey" in r && r.itemKey ? r.itemKey : r.itemName}>
                      <div className="flex justify-between">
                        <span className={isBottlenecked ? "text-amber-400" : "text-zinc-400"}>{inputLabel}</span>
                        <span className={isBottlenecked ? "text-amber-400" : ""}>
                          <span className={isBottlenecked ? "" : "text-emerald-400"}>
                            {formatRate(r.receivesInput)}
                          </span>
                          <span className={isBottlenecked ? "text-amber-500/80" : "text-zinc-500"}> / </span>
                          <span className={isBottlenecked ? "" : "text-zinc-300"}>{formatRate(r.needsInput)}/min</span>
                        </span>
                      </div>
                      {isBottlenecked && missing > 0 && (
                        <div className="flex justify-between text-xs text-amber-400">
                          <span className="text-zinc-500">Missing</span>
                          <span>{formatRate(missing)}/min</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (
          <div className="space-y-1.5 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-zinc-400">Output</span>
              <span className="text-amber-400">{formatRate((flowData as { parentSending: number })?.parentSending ?? node.totalOutput)}/min</span>
            </div>
            {!node.isRaw && node.inputPerMachine != null && (
              <div className="flex justify-between text-zinc-500">
                <span>Input</span>
                <span>{formatRate(allocatedInput)}/min</span>
              </div>
            )}
            {childCount > 0 && (
              <>
                <div className="flex justify-between text-zinc-500">
                  <span>→ to {childCount} machine{childCount !== 1 ? "s" : ""}</span>
                  <span>{formatRate(totalDemand)}/min</span>
                </div>
                {node.totalOutput > totalDemand && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Extra</span>
                    <span className="text-amber-400">{formatRate(node.totalOutput - totalDemand)}/min</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {producesOptions.length > 0 && node.isRaw && producesModalOpen && (
        <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                onClick={() => setProducesModalOpen(false)}
              >
                <div
                  className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
                    <h2 className="text-xl font-semibold text-zinc-100">Select resource</h2>
                    <button
                      type="button"
                      onClick={() => setProducesModalOpen(false)}
                      className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto p-6">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                      {sortedProduces.map((opt) => (
                        <button
                          key={opt.recipeKey}
                          type="button"
                          onClick={() => {
                            onSelectMachine(opt);
                            setProducesModalOpen(false);
                          }}
                          className={`rounded-lg border-2 px-3 py-2.5 text-left transition ${
                            node.outputItemKey === opt.outputItemKey && node.buildingKey === opt.buildingKey
                              ? "border-amber-500/60 bg-amber-600/20 text-amber-300"
                              : "border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-amber-500/50 hover:bg-zinc-800"
                          }`}
                        >
                          <div className="text-sm font-medium">{getItemName(opt.outputItemKey)}</div>
                          <div className="text-xs text-zinc-500">
                            {formatRate(opt.outputPerMachine)}/min
                          </div>
                          {getInputSlots(opt.buildingKey) > 0 && (
                            <div className="mt-0.5 text-xs text-zinc-500">{getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
        </div>
      )}

      {isOpen && machineOptions.length > 0 && (
        <div className="mt-4 border-t border-zinc-700 pt-4">
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {sortedMachine.map((opt) => (
              <button
                key={opt.recipeKey}
                type="button"
                onClick={() => {
                  onSelectMachine(opt);
                  onToggleOpen();
                }}
                className={`block w-full rounded-lg px-4 py-3 text-left text-base transition ${
                  (node.isRaw
                    ? node.outputItemKey === opt.outputItemKey && node.buildingKey === opt.buildingKey
                    : node.recipeKey === opt.recipeKey)
                    ? "bg-amber-600/30 text-amber-300"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                <div>
                  <span className="font-medium">{opt.buildingName}</span>
                  <span className="ml-2 text-zinc-500">
                    → {getItemName(opt.outputItemKey)} ({formatRate(opt.outputPerMachine)}/min)
                  </span>
                </div>
                {getInputSlots(opt.buildingKey) > 0 && (
                  <div className="mt-0.5 text-sm text-zinc-500">{getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (node.count > 1) {
                onUpdate({ count: node.count - 1 });
                        } else if (onRemove) {
                          setDeleteConfirmOpen(true);
              }
            }}
            className={`flex h-6 w-6 items-center justify-center rounded border transition ${
              node.count === 1 && onRemove
                ? "border-red-600/60 bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-red-300"
                : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
            title={node.count === 1 && onRemove ? "Delete machine" : "Decrease count"}
          >
            {node.count === 1 && onRemove ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : (
              "−"
            )}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdate({ count: node.count + 1 }); }}
            className="flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
          >
            +
          </button>
          {machineOptions.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
              className="flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
              title="Change machine"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMachinesModalOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-300"
            title="Per-machine clock (grid)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsCompact(true); }}
            className="flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-300"
            title="Compact"
          >
            ◆
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditModalOpen(true); }}
            className="flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-500 transition hover:bg-zinc-700 hover:text-amber-400"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </div>
      </div>

      </div>

      {editModalOpen && (
        <EditNodeModal
          node={node}
          machineOptions={sortedMachine}
          producesOptions={sortedProduces}
          onUpdate={onUpdate}
          onSelectMachine={(opt) => { onSelectMachine(opt); setEditModalOpen(false); }}
          onClose={() => setEditModalOpen(false)}
          onRemove={onRemove ? () => { onRemove(); setEditModalOpen(false); } : undefined}
          flowData={flowData}
          totalDemand={totalDemand}
          childCount={childCount}
          incomingBeltKey={incomingBeltKey}
        />
      )}
    </div>
    {machinesModalOpen && (
      <MachineClocksModal
        node={node}
        onClose={() => setMachinesModalOpen(false)}
        onUpdate={onUpdate}
        onBreakOut={onBreakOut}
      />
    )}
    <ConfirmModal
      open={deleteConfirmOpen}
      title="Delete machine?"
      message="This machine node will be removed from the factory."
      confirmLabel="Delete machine"
      onCancel={() => setDeleteConfirmOpen(false)}
      onConfirm={() => {
        setDeleteConfirmOpen(false);
        onRemove?.();
      }}
    />
    </>
  );
}
