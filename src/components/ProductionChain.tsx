"use client";

import { useState, useCallback } from "react";
import type { ChainStep } from "@/lib/chain";
import {
  buildChain,
  computeChainFromOutput,
  recomputeChainFromStep,
  getLinearChainItems,
} from "@/lib/chain";
import { getItem, getFluid, getBuilding, getMiner } from "@/lib/db";

const BUILDING_LABELS: Record<string, string> = {
  "miner-mk1": "Miner MK1",
  "miner-mk2": "Miner MK2",
  "miner-mk3": "Miner MK3",
  "oil-pump": "Oil Extractor",
  "water-extractor": "Water Extractor",
  smelter: "Smelter",
  constructor: "Constructor",
  assembler: "Assembler",
  foundry: "Foundry",
  "oil-refinery": "Refinery",
  manufacturer: "Manufacturer",
};

function getBuildingName(key: string): string {
  return (
    BUILDING_LABELS[key] ??
    getBuilding(key)?.name ??
    getMiner(key)?.name ??
    key
  );
}

function getItemName(key: string): string {
  return getItem(key)?.name ?? getFluid(key)?.name ?? key;
}

interface ProductionChainProps {
  className?: string;
}

export function ProductionChain({ className }: ProductionChainProps) {
  const items = getLinearChainItems();
  const [selectedItem, setSelectedItem] = useState<string>(
    () => items[0]?.key ?? ""
  );
  const [targetPerMin, setTargetPerMin] = useState(20);
  const [minerTier, setMinerTier] = useState<"miner-mk1" | "miner-mk2" | "miner-mk3">("miner-mk1");

  const chainTemplate = selectedItem ? buildChain(selectedItem) : null;
  const [steps, setSteps] = useState<ChainStep[]>(() => {
    const key = items[0]?.key ?? "";
    const chain = key ? buildChain(key) : null;
    return chain ? computeChainFromOutput(chain, 20, "miner-mk1") : [];
  });

  const updateFromTarget = useCallback(() => {
    if (!chainTemplate) return;
    setSteps(computeChainFromOutput(chainTemplate, targetPerMin, minerTier));
  }, [chainTemplate, targetPerMin, minerTier]);

  const handleItemChange = (key: string) => {
    setSelectedItem(key);
    const chain = buildChain(key);
    if (chain) {
      setSteps(computeChainFromOutput(chain, targetPerMin, minerTier));
    }
  };

  const handleMachineCountChange = (index: number, count: number) => {
    const c = Math.max(1, Math.floor(count));
    setSteps((prev) => recomputeChainFromStep(prev, index, c));
  };

  const finalOutput = steps.length > 0 ? steps[steps.length - 1]?.totalOutput ?? 0 : 0;

  return (
    <div className={className}>
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-400">
            Target item
          </label>
          <select
            value={selectedItem}
            onChange={(e) => handleItemChange(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-zinc-100 shadow-inner focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          >
            {items.map(({ key, name }) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-400">
            Target output
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={10000}
              value={targetPerMin}
              onChange={(e) => setTargetPerMin(Number(e.target.value) || 1)}
              onBlur={updateFromTarget}
              onKeyDown={(e) => e.key === "Enter" && updateFromTarget()}
              className="w-24 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2.5 text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            <span className="text-zinc-500">/min</span>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-400">
            Miner tier
          </label>
          <select
            value={minerTier}
            onChange={(e) => {
              const v = e.target.value as "miner-mk1" | "miner-mk2" | "miner-mk3";
              setMinerTier(v);
              if (chainTemplate) {
                setSteps(computeChainFromOutput(chainTemplate, targetPerMin, v));
              }
            }}
            className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          >
            <option value="miner-mk1">Miner MK1 (60/min)</option>
            <option value="miner-mk2">Miner MK2 (120/min)</option>
            <option value="miner-mk3">Miner MK3 (240/min)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={updateFromTarget}
          className="rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-zinc-950 transition hover:bg-amber-500"
        >
          Apply
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="text-zinc-500">Select an item to see the production chain.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-400">
              Production chain for {getItemName(selectedItem)}
            </h3>
            <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm font-medium text-amber-400">
              Output: {finalOutput.toFixed(1)} /min
            </span>
          </div>

          <div className="space-y-3">
            {steps.map((step, i) => (
              <div
                key={`${step.itemKey}-${i}`}
                className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex min-w-[2.5rem] items-center justify-center rounded-lg bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-400">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-zinc-100">
                    {getBuildingName(step.buildingKey)}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {getItemName(step.itemKey)}
                    {!step.isRaw && (
                      <span className="ml-1">
                        • {step.outputPerMachine.toFixed(1)}/min per machine
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm">
                    <div className="text-zinc-400">
                      {step.totalOutput.toFixed(1)} /min
                    </div>
                    {!step.isRaw && step.totalInput > 0 && (
                      <div className="text-zinc-600">
                        in: {step.totalInput.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={step.machineCount}
                      onChange={(e) =>
                        handleMachineCountChange(i, Number(e.target.value))
                      }
                      className="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-zinc-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                    />
                    <span className="text-xs text-zinc-500">machines</span>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="text-zinc-600">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 8l4 4m0 0l-4 4m4-4H3"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-lg bg-zinc-800/50 px-4 py-3">
            <p className="text-sm font-medium text-zinc-400">
              Build summary
            </p>
            <p className="mt-1 text-zinc-300">
              {steps
                .map(
                  (s) =>
                    `${s.machineCount}× ${getBuildingName(s.buildingKey)}`
                )
                .join(" → ")}
            </p>
          </div>

          <p className="mt-4 text-sm text-zinc-500">
            Change the target output and click Apply, or edit machine counts
            directly to see how the chain updates.
          </p>
        </>
      )}
    </div>
  );
}
