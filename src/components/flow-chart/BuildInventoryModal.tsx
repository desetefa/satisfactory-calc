"use client";

import { useState } from "react";
import type { BuildInventoryModalProps } from "@/components/flow-chart/flowChartTypes";

export function BuildInventoryModal({
  factoryName,
  factoryRows,
  factoryPowerShards,
  workspaceRows,
  workspacePowerShards,
  onClose,
}: BuildInventoryModalProps) {
  const [scope, setScope] = useState<"factory" | "workspace">("factory");
  const rows = scope === "factory" ? factoryRows : workspaceRows;
  const powerShards = scope === "factory" ? factoryPowerShards : workspacePowerShards;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(92vh,980px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-zinc-100">Build inventory</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex gap-1 rounded-lg border border-zinc-700 p-1">
            <button
              type="button"
              onClick={() => setScope("factory")}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${
                scope === "factory" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Factory ({factoryName})
            </button>
            <button
              type="button"
              onClick={() => setScope("workspace")}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${
                scope === "workspace" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Project (All factories)
            </button>
          </div>
          <p className="mb-4 text-sm text-zinc-500">
            Build sheet for {scope === "factory" ? factoryName : "the whole workspace"}.
          </p>
          <ul className="space-y-2">
            {rows.length === 0 && (
              <li className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-500">
                No machines in this scope yet.
              </li>
            )}
            {rows.map((row) => (
              <li
                key={`${row.buildingKey}-${row.itemKey}-${row.shardsPerMachine}`}
                className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-zinc-200">
                    {row.count}x <span className="font-medium text-amber-300">{row.itemName}</span>
                  </span>
                  <span className="shrink-0 text-right text-zinc-200">
                    {row.buildingName}
                    {row.shardsPerMachine > 0 && (
                      <span className="ml-2 text-xs text-purple-300">
                        {`(${row.shardsPerMachine} shard${row.shardsPerMachine === 1 ? "" : "s"}/machine)`}
                      </span>
                    )}
                  </span>
                </div>
                {row.buildIngredients && row.buildIngredients.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Build:{" "}
                    {row.buildIngredients.map((i, idx) => (
                      <span key={`${row.buildingKey}-${row.itemKey}-ingredient-${i.itemName}`}>
                        {idx > 0 && " + "}
                        {i.count}x <span className="font-semibold">{i.itemName}</span>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
            {powerShards > 0 && (
              <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
                <span className="min-w-0">{`${powerShards}x Power Shard${powerShards === 1 ? "" : "s"}`}</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
