"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "@/components/flow-chart/ConfirmModal";
import { getRecipeInputsPerMinute, sortOptionsNonAltFirst } from "@/lib/chain";
import { getBelt, getPipe } from "@/lib/db";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import {
  getAverageClockPercent,
  getEffectiveOutputPerMachine,
  getMachineClocks,
  getTotalClockFraction,
  totalPowerShardsForNode,
} from "@/lib/flowChartModel";
import { DraggablePercent } from "@/components/flow-chart/DraggablePercent";
import { formatRate, getInputSlots, getItemName } from "@/components/flow-chart/flowChartDisplay";
import type { EditNodeModalProps } from "@/components/flow-chart/flowChartTypes";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-zinc-800/80 py-2 last:border-0">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-zinc-200">{children}</dd>
    </div>
  );
}

function isFullFlowRate(
  fd: FlowRateData | { parentSending: number }
): fd is FlowRateData {
  return "maxOutput" in fd && typeof (fd as FlowRateData).maxOutput === "number";
}

export function EditNodeModal({
  node,
  machineOptions,
  producesOptions,
  onUpdate,
  onSelectMachine,
  onClose,
  onRemove,
  flowData,
  totalDemand,
  childCount,
  incomingBeltKey,
}: EditNodeModalProps) {
  const sortedProduces = sortOptionsNonAltFirst(producesOptions);
  const sortedMachine = sortOptionsNonAltFirst(machineOptions);
  const [producesModalOpen, setProducesModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const clocks = getMachineClocks(node);
  const clockFrac = getTotalClockFraction(node);
  const shards = totalPowerShardsForNode(node);
  const effOutPerMachine = getEffectiveOutputPerMachine(node);
  const incomingTransport = incomingBeltKey ? getBelt(incomingBeltKey) ?? getPipe(incomingBeltKey) : null;

  const recipeInputsTheoretical =
    node.recipeKey && !node.isRaw
      ? getRecipeInputsPerMinute(node.recipeKey).map(({ itemKey, perMinute }) => ({
          itemKey,
          perMinute: perMinute * clockFrac,
        }))
      : [];

  /** Portal to `document.body` so `fixed` is viewport-relative (slice columns use `transform`, which breaks fixed positioning). */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-zinc-100">Machine details</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {node.buildingName}
              <span className="text-zinc-600"> · </span>
              <span className="text-teal-400">{getItemName(node.outputItemKey)}</span>
            </p>
            {node.recipeName && (
              <p className="mt-0.5 text-xs text-zinc-500">Recipe: {node.recipeName}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-amber-500/90">Adjust</h3>
            <div className="space-y-4">
              {producesOptions.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Produces
                  </label>
                  {node.isRaw ? (
                    <button
                      type="button"
                      onClick={() => setProducesModalOpen(true)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-left transition hover:bg-zinc-700"
                    >
                      <span className="font-medium text-amber-400">{getItemName(node.outputItemKey)}</span>
                      <span className="text-xs text-zinc-500">▼</span>
                    </button>
                  ) : (
                    <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-lg border border-zinc-700 p-2">
                      {sortedProduces.map((opt) => (
                        <button
                          key={opt.recipeKey}
                          type="button"
                          onClick={() => onSelectMachine(opt)}
                          className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                            node.recipeKey === opt.recipeKey
                              ? "bg-amber-600/30 text-amber-300"
                              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                          }`}
                        >
                          <div>
                            {opt.recipeName} ({formatRate(opt.outputPerMachine)}/min)
                          </div>
                          {getInputSlots(opt.buildingKey) > 0 && (
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {machineOptions.length > 0 && producesOptions.length === 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Recipe
                  </label>
                  <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-lg border border-zinc-700 p-2">
                    {sortedMachine.map((opt) => (
                      <button
                        key={opt.recipeKey}
                        type="button"
                        onClick={() => onSelectMachine(opt)}
                        className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                          (node.isRaw ? node.outputItemKey === opt.outputItemKey : node.recipeKey === opt.recipeKey)
                            ? "bg-amber-600/30 text-amber-300"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        }`}
                      >
                        <div>
                          {opt.buildingName} → {getItemName(opt.outputItemKey)} ({formatRate(opt.outputPerMachine)}/min)
                        </div>
                        {getInputSlots(opt.buildingKey) > 0 && (
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Count</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (node.count > 1) {
                          onUpdate({ count: node.count - 1 });
                        } else if (onRemove) {
                          setDeleteConfirmOpen(true);
                        }
                      }}
                      className={`flex h-8 w-8 items-center justify-center rounded border transition ${
                        node.count === 1 && onRemove
                          ? "border-red-600/60 bg-red-900/30 text-red-400 hover:bg-red-900/50"
                          : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                      title={node.count === 1 && onRemove ? "Delete machine" : "Decrease count"}
                    >
                      {node.count === 1 && onRemove ? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      ) : (
                        "−"
                      )}
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={node.count}
                      onChange={(e) => onUpdate({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      className="w-14 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-sm text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => onUpdate({ count: node.count + 1 })}
                      className="flex h-8 w-8 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:bg-zinc-700"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">Clock % (avg / set all)</label>
                  <DraggablePercent
                    value={getAverageClockPercent(node)}
                    onChange={(v) => onUpdate({ clockPercent: v })}
                    className="block w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-sm text-zinc-100"
                    title="Sets every machine to this % (clears per-machine grid)"
                  />
                </div>
                {node.isRaw && (
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Purity</label>
                    <div className="flex gap-1">
                      {(["impure", "normal", "pure"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => onUpdate({ nodePurity: p })}
                          className={`rounded px-2 py-1 text-xs capitalize ${
                            (node.nodePurity ?? "normal") === p
                              ? "bg-amber-600/30 text-amber-300"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6 border-t border-zinc-800 pt-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Summary</h3>
              <dl className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3">
                <DetailRow label="Output item">{getItemName(node.outputItemKey)}</DetailRow>
                <DetailRow label="Machines">{node.count}</DetailRow>
                <DetailRow label="Output / min (model)">
                  {formatRate(node.totalOutput)}/min
                  <span className="ml-2 text-xs text-zinc-500">
                    ({formatRate(effOutPerMachine)}/min per machine × clock)
                  </span>
                </DetailRow>
                {node.isRaw && (
                  <DetailRow label="Node purity">
                    <span className="capitalize">{node.nodePurity ?? "normal"}</span>
                  </DetailRow>
                )}
                {incomingTransport && (
                  <DetailRow label="Incoming transport">
                    {incomingTransport.name} ({formatRate(incomingTransport.rate)}/min)
                  </DetailRow>
                )}
              </dl>
            </section>

            {flowData && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Flow simulation</h3>
                <dl className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3">
                  {isFullFlowRate(flowData) ? (
                    <>
                      <DetailRow label="Utilization">
                        {Math.round(flowData.utilization * 100)}% fed
                      </DetailRow>
                      <DetailRow label="Output (sim)">
                        {formatRate(flowData.currentOutput)} / {formatRate(flowData.maxOutput)} /min
                        <span className="ml-1 text-xs text-zinc-500">(current / max)</span>
                      </DetailRow>
                      <DetailRow label="Belt (incoming)">
                        {formatRate(flowData.receivesInput)}/{formatRate(flowData.needsInput)}/min
                        <span className="ml-2 text-xs text-zinc-500">
                          cap {formatRate(flowData.beltCapacity)}/min
                        </span>
                      </DetailRow>
                      {flowData.inputs && flowData.inputs.length > 0 && (
                        <div className="py-2">
                          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Inputs</div>
                          <ul className="space-y-1">
                            {flowData.inputs.map((row) => (
                              <li
                                key={row.itemKey}
                                className="flex justify-between gap-2 text-sm text-zinc-300"
                              >
                                <span>{row.itemName}</span>
                                <span className="font-mono text-xs">
                                  {formatRate(row.receivesInput)}/{formatRate(row.needsInput)}/min
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <DetailRow label="Raw output (sim)">
                      {formatRate((flowData as { parentSending: number }).parentSending)}/min
                    </DetailRow>
                  )}
                </dl>
              </section>
            )}

            {childCount !== undefined && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Downstream</h3>
                <dl className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3">
                  <DetailRow label="Child machines">{childCount}</DetailRow>
                  {totalDemand !== undefined && (
                    <DetailRow label="Demand for output">{formatRate(totalDemand)}/min</DetailRow>
                  )}
                </dl>
              </section>
            )}

            {recipeInputsTheoretical.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Recipe inputs (at current clocks)
                </h3>
                <ul className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                  {recipeInputsTheoretical.map(({ itemKey, perMinute }) => (
                    <li key={itemKey} className="flex justify-between gap-2 py-1 text-sm text-zinc-300">
                      <span>{getItemName(itemKey, "compact")}</span>
                      <span className="font-mono text-xs text-zinc-400">{formatRate(perMinute)}/min</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Clocks &amp; power</h3>
              <dl className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3">
                <DetailRow label="Average clock">{getAverageClockPercent(node)}%</DetailRow>
                <DetailRow label="Per-machine">
                  <span className="font-mono text-xs">
                    {clocks.map((c) => `${c}%`).join(" · ")}
                  </span>
                </DetailRow>
                <DetailRow label="Power shards (overclock)">{shards}</DetailRow>
              </dl>
            </section>
          </div>
        </div>
      </div>

      {node.isRaw && producesModalOpen && (
        <div
          className="fixed inset-0 z-110 flex items-center justify-center bg-black/70 p-4"
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
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {sortedProduces.map((opt) => (
                  <button
                    key={opt.recipeKey}
                    type="button"
                    onClick={() => {
                      onSelectMachine(opt);
                      setProducesModalOpen(false);
                    }}
                    className={`rounded-lg border-2 px-3 py-2.5 text-left text-sm ${
                      node.outputItemKey === opt.outputItemKey
                        ? "border-amber-500/60 bg-amber-600/20"
                        : "border-zinc-700 bg-zinc-800/80 hover:border-amber-500/50"
                    }`}
                  >
                    <div className="font-medium">{getItemName(opt.outputItemKey)}</div>
                    <div className="text-xs text-zinc-500">{formatRate(opt.outputPerMachine)}/min</div>
                    {getInputSlots(opt.buildingKey) > 0 && (
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {getInputSlots(opt.buildingKey)} input{getInputSlots(opt.buildingKey) !== 1 ? "s" : ""}
                      </div>
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
    </div>,
    document.body
  );
}
