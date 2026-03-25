"use client";

import type { FlowNode } from "@/lib/flowChartModel";
import {
  getAverageClockPercent,
  getEffectiveOutputPerMachine,
  getMachineClocks,
  powerShardsForClockPercent,
  totalPowerShardsForNode,
} from "@/lib/flowChartModel";
import { DraggablePercent } from "@/components/flow-chart/DraggablePercent";
import { getRecipeInputsPerMinute } from "@/lib/chain";
import { abbreviateItemDisplayName, getItemDisplayName } from "@/lib/itemDisplayName";

function formatRate(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

function ShardDots({ count }: { count: number }) {
  const cap = 8;
  const render = Math.min(count, cap);
  const overflow = count > cap ? count - cap : 0;
  if (count <= 0) return null;
  return (
    <div
      className="flex max-w-13 shrink-0 flex-wrap justify-end gap-0.5 pt-px"
      title={`${count} power shard${count !== 1 ? "s" : ""}`}
      aria-label={`${count} power shards`}
    >
      {Array.from({ length: render }, (_, j) => (
        <span
          key={j}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_3px_rgba(56,189,248,0.55)]"
          aria-hidden
        />
      ))}
      {overflow > 0 && (
        <span className="text-[9px] font-semibold leading-none text-sky-400">+{overflow}</span>
      )}
    </div>
  );
}

/** One machine: same layout language as the compact FlowNodeCard (minus count/edit actions). */
function CompactMachinePreview({
  node,
  machineIndex,
  machineCount,
  clockPercent,
  onClockChange,
}: {
  node: FlowNode;
  machineIndex: number;
  machineCount: number;
  clockPercent: number;
  onClockChange: (v: number) => void;
}) {
  const productCompact = getItemDisplayName(node.outputItemKey, "compact");
  const recipeAbbrev =
    node.recipeName && abbreviateItemDisplayName(node.recipeName, "compact");
  const showRecipeSub = Boolean(recipeAbbrev && recipeAbbrev !== productCompact);

  const perMachineOut = getEffectiveOutputPerMachine(node) * (clockPercent / 100);
  const recipeInputs =
    !node.isRaw && node.recipeKey ? getRecipeInputsPerMinute(node.recipeKey) : [];
  const machineShards = powerShardsForClockPercent(clockPercent);

  return (
    <div
      className="flex w-[200px] min-w-[200px] max-w-[200px] shrink-0 flex-col gap-1 rounded-lg border-2 border-zinc-800 bg-zinc-900/90 px-3 py-2 shadow transition-colors hover:border-zinc-600"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium leading-tight text-zinc-100">
          1 {node.buildingName}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-[10px] font-medium text-zinc-600">
            #{machineIndex + 1}/{machineCount}
          </span>
          <ShardDots count={machineShards} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="min-w-0">
          <span className="block truncate text-base font-semibold text-teal-300" title={productCompact}>
            {productCompact}
          </span>
          {showRecipeSub && (
            <span className="block truncate text-[10px] text-zinc-500" title={recipeAbbrev}>
              ({recipeAbbrev})
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-zinc-100">{formatRate(perMachineOut)}/min</span>
      </div>

      {recipeInputs.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs">
          {recipeInputs.map(({ itemKey, perMinute }) => {
            const need = perMinute * (clockPercent / 100);
            const inputLabel = getItemDisplayName(itemKey, "compact");
            return (
              <div key={itemKey} className="flex justify-between gap-1 font-mono">
                <span className="min-w-0 truncate text-zinc-500">{inputLabel}</span>
                <span className="shrink-0 text-zinc-300">{formatRate(need)}/min</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-0.5 flex items-center justify-end border-t border-zinc-800/80 pt-1.5">
        <DraggablePercent
          value={clockPercent}
          onChange={onClockChange}
          className="shrink-0 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          title="Clock % for this machine"
        />
      </div>
    </div>
  );
}

export function MachineClocksModal({
  node,
  onClose,
  onUpdate,
}: {
  node: FlowNode;
  onClose: () => void;
  onUpdate: (u: Partial<FlowNode>) => void;
}) {
  const clocks = getMachineClocks(node);
  const shards = totalPowerShardsForNode(node);
  const product = getItemDisplayName(node.outputItemKey, "comfortable");
  const displayOut = getEffectiveOutputPerMachine(node) * clocks.reduce((s, c) => s + c / 100, 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-[68rem] overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="machine-clocks-title"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-700 px-5 py-4">
          <div className="min-w-0">
            <h2 id="machine-clocks-title" className="text-lg font-semibold text-zinc-100">
              Per-machine clock
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {node.count} × {node.buildingName} · {product}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              ~{formatRate(displayOut)}/min combined
              {shards > 0 && (
                <span className="text-purple-300">
                  {" "}
                  · {shards} power shard{shards !== 1 ? "s" : ""}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[calc(90vh-12rem)] overflow-y-auto overflow-x-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Set all</span>
            <DraggablePercent
              value={getAverageClockPercent(node)}
              onChange={(v) => onUpdate({ clockPercent: v })}
              className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-center text-xs text-zinc-100"
            />
            <span className="text-xs text-zinc-600">Resets to one clock % for every machine.</span>
          </div>

          <div className="grid grid-cols-[repeat(5,200px)] gap-3">
            {clocks.map((c, i) => (
              <CompactMachinePreview
                key={i}
                node={node}
                machineIndex={i}
                machineCount={clocks.length}
                clockPercent={c}
                onClockChange={(v) => {
                  const next = [...clocks];
                  next[i] = v;
                  onUpdate({ machineClockPercents: next });
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
