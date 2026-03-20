"use client";

import { useState, useCallback, useMemo, useEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import type { KeyName } from "@/lib/types";
import {
  buildChain,
  computeChainFromOutput,
  getAllProductKeysWithRecipes,
  getExtractorMachineOptions,
  getExtractorMachineOptionsFull,
  getMachineOptionsForInput,
  getMachineOptionsForProduct,
  getRecipeInputsPerMinute,
  sortOptionsNonAltFirst,
} from "@/lib/chain";
import { getItem, getFluid, getBuilding, getBuildingForRecipe, getMiner, getAllBelts, getBelt, getRecipe, recipePerMinute } from "@/lib/db";
import {
  getSavedCharts,
  loadChart,
  saveChart,
  deleteChart,
  getLastChartId,
  generateChartId,
  type SavedChart,
} from "@/lib/chartStorage";
import {
  abbreviateItemDisplayName,
  getItemDisplayName,
  type ItemDisplayDensity,
} from "@/lib/itemDisplayName";
import { QuickBuildFab, QuickBuildModal } from "@/components/QuickBuildModal";
import {
  type NodePurity,
  type FlowNode,
  type InputEdge,
  type TreeNode,
  createFlowNode,
  createTreeNode,
  getEffectiveOutputPerMachine,
} from "@/lib/flowChartModel";
import { planProductionFromTarget } from "@/lib/productionPlanner";
import { productionPlanToSliceTree } from "@/lib/plannerToTree";

export type { NodePurity, FlowNode, InputEdge, TreeNode } from "@/lib/flowChartModel";

const createNode = createFlowNode;

function getItemName(key: string, density: ItemDisplayDensity = "comfortable"): string {
  return getItemDisplayName(key, density);
}

/** Format rate for display - shows decimals when needed (e.g. 37.5, 60) */
function formatRate(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

/** Number of input slots for a building (Constructor 1, Assembler 2, Manufacturer 4, etc.) */
function getInputSlots(buildingKey: string): number {
  return getBuilding(buildingKey)?.max ?? 0;
}

/** Draggable percent: drag left/right to adjust value (1–250). Uses pointer capture so drag continues when mouse moves outside. */
function DraggablePercent({
  value,
  onChange,
  min = 1,
  max = 250,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);
    const startX = e.clientX;
    /** Value at pointer down — cumulative dx avoids per-move rounding + magnetic snap feel */
    const startValue = value;
    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, Math.round(startValue + dx / 2)));
      onChange(next);
    };
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
      document.body.style.userSelect = "none";
    document.body.style.cursor = "none";
  };

  return (
    <span
      role="slider"
      tabIndex={0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`cursor-ew-resize select-none touch-none ${className}`}
      onPointerDown={handlePointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(Math.max(min, value - step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(Math.min(max, value + step));
        }
      }}
    >
      {value}%
    </span>
  );
}

type MachineOption = {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
};

interface AddMachineModalProps {
  title: string;
  options: MachineOption[];
  onSelect: (opt: MachineOption) => void;
  onClose: () => void;
}

const BELTS = getAllBelts().sort((a, b) => a.rate - b.rate);


function InputFlowBadge({
  value,
  onChange,
  beltCapacity,
  receivesInput,
  itemName,
  compact = false,
  fullWidth = false,
  readOnly = false,
}: {
  value: string;
  onChange: (key: string) => void;
  beltCapacity: number;
  receivesInput: number;
  itemName: string;
  compact?: boolean;
  fullWidth?: boolean;
  readOnly?: boolean;
}) {
  const isBottleneck = receivesInput >= beltCapacity && beltCapacity > 0;
  if (compact) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
          fullWidth ? "w-full min-w-full" : ""
        } ${
          isBottleneck ? "bg-amber-500/20 text-amber-300" : "bg-zinc-800/90 text-zinc-300"
        }`}
      >
        <span>{formatRate(receivesInput)}{itemName ? ` ${itemName}` : ""}</span>
        {!readOnly && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer border-none bg-transparent py-0 text-inherit focus:outline-none focus:ring-0"
          title="Change belt"
        >
          {BELTS.map((b) => (
            <option key={b.key_name} value={b.key_name}>
              {formatRate(b.rate)}/min
            </option>
          ))}
        </select>
        )}
      </div>
    );
  }
  return (
    <div
      className={`mt-2 flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${
        isBottleneck ? "bg-amber-500/20 text-amber-300" : "bg-zinc-800/90 text-zinc-300"
      }`}
    >
      <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Input</span>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <span>
        {formatRate(receivesInput)}
        {itemName && <span className="ml-1.5">{itemName}</span>}
      </span>
      <span className="text-zinc-500">·</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer border-none bg-transparent py-0 text-inherit focus:outline-none focus:ring-0"
        title="Change belt"
      >
        {BELTS.map((b) => (
          <option key={b.key_name} value={b.key_name}>
            {formatRate(b.rate)}/min
          </option>
        ))}
      </select>
      </div>
    </div>
  );
}

function BranchingConnector({
  branchCount,
  className = "",
}: {
  branchCount: number;
  className?: string;
}) {
  if (branchCount <= 0) return null;
  if (branchCount === 1) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <div className="h-4 w-px bg-zinc-600" />
        <svg className="h-6 w-6 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`flex w-full flex-col items-center ${className}`}>
      <div className="h-4 w-px bg-zinc-600" />
      <div className="h-px w-full max-w-[min(100%,400px)] bg-zinc-600" style={{ width: "calc(100% - 2rem)" }} />
      <div className="flex w-full max-w-[min(100%,400px)] justify-around" style={{ width: "calc(100% - 2rem)" }}>
        {Array.from({ length: branchCount }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="h-4 w-px bg-zinc-600" />
            <svg className="h-5 w-5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

function BranchingConnectorHorizontal({ className = "" }: { className?: string }) {
  return (
    <div className={`flex shrink-0 flex-row items-center gap-0 ${className}`}>
      <div className="h-px w-3 bg-zinc-600" />
      <svg className="h-4 w-4 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H3" />
      </svg>
    </div>
  );
}

function HorizontalMultiBranchConnector({ childCount }: { childCount: number }) {
  if (childCount <= 0) return null;
  return (
    <div className="flex shrink-0 flex-row">
      <div className="flex flex-col justify-around py-1">
        {Array.from({ length: childCount }).map((_, i) => (
          <div key={i} className="flex items-center">
            <div className="h-px w-2 bg-zinc-600" />
            <svg className="h-3 w-3 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H3" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

function getUniqueBuildings(options: MachineOption[]): { buildingKey: string; buildingName: string; firstOption: MachineOption }[] {
  const seen = new Set<string>();
  const result: { buildingKey: string; buildingName: string; firstOption: MachineOption }[] = [];
  for (const opt of options) {
    if (!seen.has(opt.buildingKey)) {
      seen.add(opt.buildingKey);
      result.push({
        buildingKey: opt.buildingKey,
        buildingName: opt.buildingName,
        firstOption: opt,
      });
    }
  }
  return result;
}

type AddMachineModalTab = "machine" | "product";

function AddMachineModal({ title, options, onSelect, onClose }: AddMachineModalProps) {
  const [tab, setTab] = useState<AddMachineModalTab>("machine");
  const [selectedBuilding, setSelectedBuilding] = useState<{ buildingKey: string; buildingName: string } | null>(null);
  const [productPickKey, setProductPickKey] = useState<KeyName | null>(null);
  const [productQuery, setProductQuery] = useState("");

  const sorted = sortOptionsNonAltFirst(options);
  const allBuildings = getUniqueBuildings(sorted);

  const extractors = allBuildings
    .filter((b) => getMiner(b.buildingKey))
    .sort((a, b) => getInputSlots(a.buildingKey) - getInputSlots(b.buildingKey));

  const producers = allBuildings
    .filter((b) => !getMiner(b.buildingKey))
    .sort((a, b) => getInputSlots(a.buildingKey) - getInputSlots(b.buildingKey));

  const productOptions = selectedBuilding
    ? sorted.filter((opt) => opt.buildingKey === selectedBuilding.buildingKey)
    : [];

  const allProductKeys = useMemo(() => getAllProductKeysWithRecipes(), []);
  const productRecipes = useMemo(
    () => (productPickKey ? getMachineOptionsForProduct(productPickKey) : []),
    [productPickKey]
  );

  const filteredProductKeys = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return allProductKeys;
    return allProductKeys.filter((key) => {
      const label = getItemName(key).toLowerCase();
      return label.includes(q) || key.toLowerCase().includes(q);
    });
  }, [allProductKeys, productQuery]);

  const switchTab = (next: AddMachineModalTab) => {
    setTab(next);
    setSelectedBuilding(null);
    setProductPickKey(null);
    setProductQuery("");
  };

  const showBack =
    (tab === "machine" && selectedBuilding !== null) || (tab === "product" && productPickKey !== null);

  const handleBack = () => {
    if (tab === "machine") setSelectedBuilding(null);
    else setProductPickKey(null);
  };

  const headerTitle =
    tab === "product" && productPickKey
      ? `${getItemName(productPickKey)} – Choose recipe`
      : tab === "product"
        ? "Choose product"
        : selectedBuilding
          ? `${selectedBuilding.buildingName} – Choose product`
          : title;

  const renderGroup = (label: string, buildings: typeof allBuildings) => {
    if (buildings.length === 0) return null;
    return (
      <div key={label} className="mb-6 last:mb-0">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">{label}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {buildings.map(({ buildingKey, buildingName, firstOption }) => (
            <button
              key={buildingKey}
              type="button"
              onClick={() => setSelectedBuilding({ buildingKey, buildingName })}
              className="rounded-xl border-2 border-zinc-700 bg-zinc-800/80 px-5 py-4 text-left transition hover:border-amber-500/50 hover:bg-zinc-800"
            >
              <div className="font-medium text-zinc-100">{buildingName}</div>
              {getInputSlots(firstOption.buildingKey) > 0 && (
                <div className="mt-1 text-xs text-zinc-500">{getInputSlots(firstOption.buildingKey)} input{getInputSlots(firstOption.buildingKey) !== 1 ? "s" : ""}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showBack && (
              <button
                type="button"
                onClick={handleBack}
                className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                title="Back"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="min-w-0 truncate text-xl font-semibold text-zinc-100">{headerTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="border-b border-zinc-800 px-6 pt-3">
          <div className="flex gap-1 rounded-lg bg-zinc-800/60 p-1">
            <button
              type="button"
              onClick={() => switchTab("machine")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                tab === "machine" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              By machine
            </button>
            <button
              type="button"
              onClick={() => switchTab("product")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                tab === "product" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              By product
            </button>
          </div>
        </div>

        <div className="max-h-[calc(85vh-11rem)] overflow-y-auto p-6">
          {tab === "machine" ? (
            selectedBuilding ? (
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  What should this {selectedBuilding.buildingName} produce?
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {productOptions.map((opt) => (
                    <button
                      key={opt.recipeKey}
                      type="button"
                      onClick={() => onSelect(opt)}
                      className="rounded-xl border-2 border-zinc-700 bg-zinc-800/80 px-5 py-4 text-left transition hover:border-amber-500/50 hover:bg-zinc-800"
                    >
                      <div className="font-medium text-zinc-100">{opt.recipeName}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatRate(opt.outputPerMachine)}/min per machine
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  Choose a machine type, then select what it produces.
                </p>
                {renderGroup("Extractors", extractors)}
                {renderGroup("Producers", producers)}
              </>
            )
          ) : productPickKey ? (
            <>
              <p className="mb-4 text-sm text-zinc-500">
                Pick a recipe (standard recipes first). The correct building is selected automatically.
              </p>
              {productRecipes.length === 0 ? (
                <p className="text-sm text-zinc-500">No recipes found for this product.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {productRecipes.map((opt) => (
                    <button
                      key={opt.recipeKey}
                      type="button"
                      onClick={() => onSelect(opt)}
                      className="rounded-xl border-2 border-zinc-700 bg-zinc-800/80 px-5 py-4 text-left transition hover:border-amber-500/50 hover:bg-zinc-800"
                    >
                      <div className="font-medium text-zinc-100">{opt.recipeName}</div>
                      <div className="mt-1 text-xs text-zinc-500">{opt.buildingName}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatRate(opt.outputPerMachine)}/min per machine
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-zinc-500">
                Search or pick an output item, then choose how to produce it.
              </p>
              <input
                type="search"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Filter products…"
                className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
              />
              <div className="max-h-[min(50vh,28rem)] overflow-y-auto rounded-lg border border-zinc-800">
                {filteredProductKeys.length === 0 ? (
                  <p className="p-4 text-sm text-zinc-500">No matching products.</p>
                ) : (
                  <ul className="divide-y divide-zinc-800">
                    {filteredProductKeys.map((key) => (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setProductPickKey(key)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-zinc-800/80"
                        >
                          <span className="font-medium">{getItemName(key)}</span>
                          <span className="text-zinc-600">→</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveAsModal({
  currentName,
  onSave,
  onClose,
}: {
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(currentName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border-2 border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-semibold text-zinc-100">Save chart as</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chart name"
          className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-100 placeholder-zinc-500"
          onKeyDown={(e) => e.key === "Enter" && onSave(name.trim() || "Untitled")}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-300 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(name.trim() || "Untitled")}
            className="rounded-lg border border-amber-500/60 bg-amber-600/30 px-4 py-2 text-amber-300 hover:bg-amber-600/40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildInventoryModal({
  buildings,
  powerShards,
  onClose,
}: {
  buildings: { buildingKey: string; buildingName: string; count: number }[];
  powerShards: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
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
        <div className="max-h-[min(60vh,480px)] overflow-y-auto p-6">
          <p className="mb-4 text-sm text-zinc-500">
            Machines and power shards for overclock (&gt;100%: up to 3 shards per machine at 201–250%).
          </p>
          <ul className="space-y-2">
            {buildings.map((row) => (
              <li
                key={row.buildingKey}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200"
              >
                <span className="min-w-0">{row.buildingName}</span>
                <span className="shrink-0 font-mono text-amber-400">×{row.count}</span>
              </li>
            ))}
            {powerShards > 0 && (
              <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
                <span className="min-w-0">Power Shard</span>
                <span className="shrink-0 font-mono text-purple-300">×{powerShards}</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface EditNodeModalProps {
  node: FlowNode;
  machineOptions: MachineOption[];
  producesOptions: MachineOption[];
  onUpdate: (u: Partial<FlowNode>) => void;
  onSelectMachine: (opt: MachineOption) => void;
  onClose: () => void;
  onSeparate?: () => void;
  onRemove?: () => void;
}

function EditNodeModal({
  node,
  machineOptions,
  producesOptions,
  onUpdate,
  onSelectMachine,
  onClose,
  onSeparate,
  onRemove,
}: EditNodeModalProps) {
  const sortedProduces = sortOptionsNonAltFirst(producesOptions);
  const sortedMachine = sortOptionsNonAltFirst(machineOptions);
  const [producesModalOpen, setProducesModalOpen] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Edit {node.buildingName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {producesOptions.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">Produces</label>
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
                      <div>{opt.recipeName} ({formatRate(opt.outputPerMachine)}/min)</div>
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
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">Recipe</label>
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
                    <div>{opt.buildingName} → {getItemName(opt.outputItemKey)} ({formatRate(opt.outputPerMachine)}/min)</div>
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
                    } else if (onRemove && window.confirm("Do you want to delete this machine?")) {
                      onRemove();
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
              <label className="mb-1 block text-xs text-zinc-500">Clock %</label>
              <DraggablePercent
                value={node.clockPercent}
                onChange={(v) => onUpdate({ clockPercent: v })}
                className="block w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-sm text-zinc-100"
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

      {node.isRaw && producesModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
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
                      node.outputItemKey === opt.outputItemKey ? "border-amber-500/60 bg-amber-600/20" : "border-zinc-700 bg-zinc-800/80 hover:border-amber-500/50"
                    }`}
                  >
                    <div className="font-medium">{getItemName(opt.outputItemKey)}</div>
                    <div className="text-xs text-zinc-500">{formatRate(opt.outputPerMachine)}/min</div>
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
    </div>
  );
}

function pickDefaultBelt(throughput: number): string {
  const belts = getAllBelts().sort((a, b) => a.rate - b.rate);
  const match = belts.find((b) => b.rate >= throughput);
  return match?.key_name ?? belts[belts.length - 1]?.key_name ?? "belt1";
}

function getAllLeaves(tree: TreeNode): TreeNode[] {
  if (tree.children.length === 0) return [tree];
  return tree.children.flatMap((c) => getAllLeaves(c));
}

type StorageStripRow = {
  itemKey: KeyName;
  itemName: string;
  surplusRate: number;
  reservePerMin: number;
};

function StorageStrip({
  rows,
  onReserveDelta,
  onOptimizeRow,
}: {
  rows: StorageStripRow[];
  onReserveDelta: (itemKey: KeyName, delta: number) => void;
  onOptimizeRow: (itemKey: KeyName) => void;
}) {
  return (
    <aside
      className="flex h-full min-h-0 w-64 shrink-0 flex-col border-l border-zinc-800 bg-[#101010] backdrop-blur-md"
      aria-label="Storage"
    >
      <div className="shrink-0 border-b border-zinc-800 px-3 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Storage</h2>
        <p className="mt-1 text-xs leading-snug text-zinc-600">
          Surplus vs downstream use. +/− set a personal reserve (items/min); ✕ trims waste (machines first,
          then clock).
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-600">Nothing in storage</p>
        ) : (
          <ul className="space-y-3">
            {rows.map(({ itemKey, itemName, surplusRate, reservePerMin }) => (
              <li
                key={itemKey}
                className="flex flex-col gap-1.5 border-b border-zinc-800/80 pb-3 last:border-0 last:pb-0"
              >
                <span className="text-sm font-medium leading-tight text-zinc-200">{itemName}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-amber-400/90" title="Current surplus">
                    +{formatRate(surplusRate)}/min
                  </span>
                  {reservePerMin > 0 && (
                    <span className="font-mono text-[11px] text-teal-400/90" title="Target extra reserve">
                      r{formatRate(reservePerMin)}/min
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Increase reserve by 1/min (scale up first producer)"
                    onClick={() => onReserveDelta(itemKey, 1)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-sm font-medium text-zinc-200 hover:border-amber-500/50 hover:bg-zinc-700"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    title="Decrease reserve by 1/min"
                    onClick={() => onReserveDelta(itemKey, -1)}
                    disabled={reservePerMin <= 0}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-sm font-medium text-zinc-200 hover:border-amber-500/50 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    title="Clear reserve and remove surplus (whole machines first, then lower clock)"
                    onClick={() => onOptimizeRow(itemKey)}
                    className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-xs font-bold text-zinc-400 hover:border-red-500/40 hover:bg-red-950/40 hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function getAllNodes(tree: TreeNode): TreeNode[] {
  return [tree, ...tree.children.flatMap((c) => getAllNodes(c))];
}

/** Power shards slotted for overclock: 101–150% → 1, 151–200% → 2, 201–250% → 3 per machine. */
function powerShardsForClockPercent(clockPercent: number): number {
  if (clockPercent <= 100) return 0;
  if (clockPercent <= 150) return 1;
  if (clockPercent <= 200) return 2;
  return 3;
}

type BuildInventoryResult = {
  buildings: { buildingKey: string; buildingName: string; count: number }[];
  powerShards: number;
};

/** Machines and power shards needed for the current flow. */
function computeBuildInventory(tree: TreeNode): BuildInventoryResult | null {
  if (!tree.node.outputItemKey) return null;

  const buildingMap = new Map<string, { buildingName: string; count: number }>();
  let powerShards = 0;
  for (const t of getAllNodes(tree)) {
    const { buildingKey, buildingName, count, outputItemKey, clockPercent } = t.node;
    if (!buildingKey || !outputItemKey) continue;
    const prev = buildingMap.get(buildingKey);
    if (prev) prev.count += count;
    else buildingMap.set(buildingKey, { buildingName, count });
    const perMachine = powerShardsForClockPercent(clockPercent);
    powerShards += perMachine * count;
  }

  const buildings = [...buildingMap.entries()]
    .map(([buildingKey, { buildingName, count }]) => ({ buildingKey, buildingName, count }))
    .sort((a, b) => a.buildingName.localeCompare(b.buildingName));

  return { buildings, powerShards };
}

function findNode(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

const EMPTY_FLOW_RELATED_IDS = new Set<string>();

/**
 * Horizontal flow columns (same grouping as TreeLevelSlices): machines at the same “stage”
 * appear together even when they’re not in each other’s parent/child chain.
 */
function getFlowSlices(t: TreeNode): TreeNode[][] {
  if (!t.node.outputItemKey) return [];
  const result: TreeNode[][] = [];
  const rawChildren = t.children.filter((c) => c.node.isRaw);
  const consumerChildren = t.children.filter((c) => !c.node.isRaw);
  const level0 = [t, ...rawChildren];
  let level: TreeNode[] = level0;
  let nextLevel: TreeNode[] = [
    ...consumerChildren,
    ...rawChildren.flatMap((c) => c.children),
  ];
  while (level.length > 0) {
    result.push(level);
    level = nextLevel;
    nextLevel = level.flatMap((n) => n.children);
  }
  return result;
}

/**
 * Who supplies `itemKey` to this consumer: tree parent, explicit input edge, or (fallback)
 * any node in an earlier horizontal slice that outputs that item (matches add-machine / pool semantics).
 */
function resolveSupplierIds(tree: TreeNode, consumer: TreeNode, itemKey: KeyName): string[] {
  const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
  if (parent?.node.outputItemKey === itemKey) {
    return [parent.id];
  }

  const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
  if (edge) {
    return [edge.producerId];
  }

  const slices = getFlowSlices(tree);
  const consumerSlice = slices.findIndex((sl) => sl.some((n) => n.id === consumer.id));
  if (consumerSlice <= 0) return [];

  const found: string[] = [];
  for (let s = consumerSlice - 1; s >= 0; s--) {
    for (const n of slices[s]!) {
      if (n.node.outputItemKey === itemKey) found.push(n.id);
    }
    if (found.length > 0) break;
  }
  return [...new Set(found)];
}

/** Transitive upstream: every machine (and miner) needed to produce the hovered node's inputs. */
function collectUpstreamSupplyIds(tree: TreeNode, nodeId: string, into: Set<string>) {
  const node = findNode(tree, nodeId);
  if (!node) return;

  if (node.node.isRaw || !node.node.recipeKey) {
    return;
  }

  for (const { itemKey } of getRecipeInputsPerMinute(node.node.recipeKey)) {
    for (const sid of resolveSupplierIds(tree, node, itemKey)) {
      if (sid === nodeId) continue;
      if (!into.has(sid)) {
        into.add(sid);
        collectUpstreamSupplyIds(tree, sid, into);
      }
    }
  }
}

/**
 * All nodes that supply the hovered machine (transitive recipe closure). Excludes `nodeId`.
 */
function getRelatedNodeIdsForHover(tree: TreeNode, nodeId: string): Set<string> {
  if (!findNode(tree, nodeId)) return EMPTY_FLOW_RELATED_IDS;
  const ids = new Set<string>();
  collectUpstreamSupplyIds(tree, nodeId, ids);
  return ids;
}

/**
 * Add missing {@link InputEdge} rows so each recipe input is either from the tree parent or has an edge.
 * Older charts and some trees only had pool semantics in {@link computeFlowRates}; without edges, belt
 * dropdowns updated {@link TreeNode.incomingBeltKey} but flow math ignored it for those inputs.
 */
function synthesizeMissingInputEdges(tree: TreeNode): TreeNode {
  let out = tree;

  function visit(t: TreeNode) {
    for (const c of t.children) {
      visit(c);
    }
    if (!t.node.recipeKey || t.node.isRaw) return;

    const parent = t.parentId ? findNode(out, t.parentId) : null;
    const existingKeys = new Set((t.inputEdges ?? []).map((e) => e.itemKey));
    const newEdges: InputEdge[] = [];

    for (const { itemKey, perMinute } of getRecipeInputsPerMinute(t.node.recipeKey)) {
      if (existingKeys.has(itemKey)) continue;
      if (parent?.node.outputItemKey === itemKey) continue;

      const suppliers = resolveSupplierIds(out, t, itemKey);
      if (suppliers.length === 0) continue;

      const edge: InputEdge = {
        itemKey,
        producerId: suppliers[0]!,
        beltKey: pickDefaultBelt(perMinute * t.node.count),
      };
      newEdges.push(edge);
      existingKeys.add(itemKey);
    }

    if (newEdges.length > 0) {
      out = replaceNode(out, t.id, (tn) => ({
        ...tn,
        inputEdges: [...(tn.inputEdges ?? []), ...newEdges],
      }));
    }
  }

  visit(tree);
  return out;
}

function replaceNode(tree: TreeNode, nodeId: string, replacer: (t: TreeNode) => TreeNode): TreeNode {
  if (tree.id === nodeId) return replacer(tree);
  return {
    ...tree,
    children: tree.children.map((c) => replaceNode(c, nodeId, replacer)),
  };
}

function updateChildBeltInTree(
  tree: TreeNode,
  parentId: string,
  childId: string,
  incomingBeltKey: string
): TreeNode {
  return replaceNode(tree, parentId, (t) => ({
    ...t,
    children: t.children.map((c) =>
      c.id === childId ? { ...c, incomingBeltKey } : c
    ),
  }));
}

function updateInputEdgeBeltInTree(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  beltKey: string
): TreeNode {
  return replaceNode(tree, consumerId, (t) => {
    if (!t.inputEdges) return t;
    return {
      ...t,
      inputEdges: t.inputEdges.map((e) =>
        e.itemKey === itemKey ? { ...e, beltKey } : e
      ),
    };
  });
}

function updateNodeInTree(tree: TreeNode, nodeId: string, updates: Partial<FlowNode>): TreeNode {
  return replaceNode(tree, nodeId, (t) => {
    const node = { ...t.node, ...updates };
    if (
      updates.count !== undefined ||
      updates.clockPercent !== undefined ||
      updates.outputPerMachine !== undefined ||
      updates.nodePurity !== undefined
    ) {
      node.totalOutput =
        getEffectiveOutputPerMachine(node) * (node.clockPercent / 100) * node.count;
    }
    return { ...t, node };
  });
}

function addChildToNode(
  tree: TreeNode,
  parentId: string,
  newNode: FlowNode,
  prepend: boolean | number = false,
  inputEdges?: InputEdge[]
): TreeNode {
  const throughput = (newNode.inputPerMachine ?? 0) * newNode.count;
  const beltKey = pickDefaultBelt(throughput);
  const newChild: TreeNode = { ...createTreeNode(newNode, parentId, [], beltKey), inputEdges };
  return replaceNode(tree, parentId, (t) => {
    const insertIdx =
      prepend === true ? 0 : typeof prepend === "number" ? Math.max(0, Math.min(prepend, t.children.length)) : t.children.length;
    const next = [...t.children];
    next.splice(insertIdx, 0, newChild);
    return { ...t, children: next };
  });
}

/** Merge two siblings that produce the same output: combine counts into left, remove right. Move right's children to left. */
function mergeNodesAsChild(
  tree: TreeNode,
  parentId: string,
  leftId: string,
  rightId: string
): TreeNode {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;
  const leftIdx = parent.children.findIndex((c) => c.id === leftId);
  const rightIdx = parent.children.findIndex((c) => c.id === rightId);
  if (leftIdx < 0 || rightIdx < 0 || leftIdx >= rightIdx) return tree;
  const left = parent.children[leftIdx];
  const right = parent.children[rightIdx];
  if (left.node.outputItemKey !== right.node.outputItemKey) return tree;
  const combinedCount = left.node.count + right.node.count;
  let updated = replaceNode(tree, leftId, (l) => ({
    ...l,
    node: {
      ...l.node,
      count: combinedCount,
      totalOutput:
        getEffectiveOutputPerMachine(l.node) * (l.node.clockPercent / 100) * combinedCount,
    },
    children: [...l.children, ...right.children.map((c) => ({ ...c, parentId: leftId }))],
  }));
  updated = replaceNode(updated, parentId, (p) => ({
    ...p,
    children: p.children.filter((c) => c.id !== rightId),
  }));
  return updated;
}

/** Split a merged node (count > 1) into two siblings. Children stay with the first (count 1). */
function splitMergedNode(
  tree: TreeNode,
  parentId: string,
  nodeId: string
): TreeNode {
  const parent = findNode(tree, parentId);
  if (!parent) return tree;
  const node = parent.children.find((c) => c.id === nodeId);
  if (!node || node.node.count < 2) return tree;
  const leftCount = 1;
  const rightCount = node.node.count - 1;
  const leftNode = {
    ...node.node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    count: leftCount,
    totalOutput:
      getEffectiveOutputPerMachine(node.node) * (node.node.clockPercent / 100) * leftCount,
  };
  const rightNode = {
    ...node.node,
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-r`,
    count: rightCount,
    totalOutput:
      getEffectiveOutputPerMachine(node.node) * (node.node.clockPercent / 100) * rightCount,
  };
  const throughput = (rightNode.inputPerMachine ?? 0) * rightCount;
  const leftChild = createTreeNode(leftNode, parentId, node.children, node.incomingBeltKey);
  const rightChild = createTreeNode(rightNode, parentId, [], pickDefaultBelt(throughput));
  const newChildren = parent.children.flatMap((c) =>
    c.id === nodeId ? [leftChild, rightChild] : [c]
  );
  return replaceNode(tree, parentId, (p) => ({
    ...p,
    children: newChildren,
  }));
}

export type FlowInputData = {
  itemKey: KeyName;
  itemName: string;
  needsInput: number;
  receivesInput: number;
};

export type FlowRateData = {
  /** What the parent is sending (total) - for display on connection */
  parentSending: number;
  /** Belt capacity for this connection (items/min) */
  beltCapacity: number;
  /** What this machine needs (inputPerMachine × count) - legacy single-input */
  needsInput: number;
  /** What this machine actually receives (belt-limited, supply-limited) - legacy */
  receivesInput: number;
  /** Per-input breakdown for multi-input machines */
  inputs?: FlowInputData[];
  /** Max output if 100% fed */
  maxOutput: number;
  /** Actual output based on input utilization */
  currentOutput: number;
  /** 0-1, how well fed */
  utilization: number;
};

function getChildDemandForParentOutput(child: TreeNode, parentOutputItemKey: KeyName): number {
  if (child.node.isRaw || !child.node.recipeKey) return 0;
  const inputs = getRecipeInputsPerMinute(child.node.recipeKey);
  const match = inputs.find((i) => i.itemKey === parentOutputItemKey);
  const directNeed = (match?.perMinute ?? 0) * child.node.count;

  // Downstream demand: children of this node need our output; we need enough input to produce it
  if (child.children.length === 0) return directNeed;

  const outputItemKey = child.node.outputItemKey;
  if (!outputItemKey) return directNeed;

  let downstreamOutputNeed = 0;
  for (const grandchild of child.children) {
    downstreamOutputNeed += getChildDemandForParentOutput(grandchild, outputItemKey);
  }

  const recipe = getRecipe(child.node.recipeKey);
  if (!recipe || !match) return directNeed;

  const { products } = recipePerMinute(recipe);
  const outputPerMin = products.find(([k]) => k === outputItemKey)?.[1] ?? 0;
  if (outputPerMin <= 0) return directNeed;

  // inputNeeded = outputDemand * (inputPerMin / outputPerMin)
  const inputNeededForDownstream =
    downstreamOutputNeed * (match.perMinute / outputPerMin);

  return Math.max(directNeed, inputNeededForDownstream);
}

function getSlicesForFlow(tree: TreeNode): TreeNode[][] {
  return getFlowSlices(tree);
}

function computeFlowRates(tree: TreeNode): Map<string, FlowRateData | { parentSending: number }> {
  const result = new Map<string, FlowRateData | { parentSending: number }>();
  const slices = getSlicesForFlow(tree);
  if (slices.length === 0) return result;

  const pools = new Map<KeyName, number>();
  const nodeToSlice = new Map<string, number>();
  slices.forEach((nodes, idx) => nodes.forEach((n) => nodeToSlice.set(n.id, idx)));

  for (let sliceIdx = 0; sliceIdx < slices.length; sliceIdx++) {
    const sliceNodes = slices[sliceIdx]!;
    const prevSlice = sliceIdx > 0 ? slices[sliceIdx - 1]! : [];

    for (const node of sliceNodes) {
      if (node.node.isRaw || !node.node.recipeKey) {
        const out = getEffectiveOutputPerMachine(node.node) * (node.node.clockPercent / 100) * node.node.count;
        const key = node.node.outputItemKey;
        if (key) pools.set(key, (pools.get(key) ?? 0) + out);
        result.set(node.id, { parentSending: out });
        continue;
      }

      const recipeInputs = getRecipeInputsPerMinute(node.node.recipeKey);
      const inputs: FlowInputData[] = recipeInputs.map(({ itemKey, perMinute }) => ({
        itemKey,
        itemName: getItemName(itemKey, "compact"),
        needsInput: perMinute * node.node.count,
        receivesInput: 0,
      }));

      for (const inp of inputs) {
        if (inp.needsInput <= 0) continue;
        const poolAvail = pools.get(inp.itemKey) ?? 0;
        let beltCap = 9999;
        const parent = node.parentId ? findNode(tree, node.parentId) : null;
        if (parent?.node.outputItemKey === inp.itemKey) {
          const b = getBelt(node.incomingBeltKey ?? "belt1");
          beltCap = b?.rate ?? 60;
        } else {
          const edge = node.inputEdges?.find((e) => e.itemKey === inp.itemKey);
          if (edge) {
            const b = getBelt(edge.beltKey);
            beltCap = b?.rate ?? 60;
          }
        }
        const take = Math.min(inp.needsInput, poolAvail, beltCap);
        inp.receivesInput = take;
        pools.set(inp.itemKey, Math.max(0, poolAvail - take));
      }

      const withNeeds = inputs.filter((i) => i.needsInput > 0);
      const utilization =
        withNeeds.length > 0
          ? Math.min(1, ...withNeeds.map((i) => (i.needsInput > 0 ? i.receivesInput / i.needsInput : 1)))
          : 1;
      const maxOutput = node.node.outputPerMachine * (node.node.clockPercent / 100) * node.node.count;
      const currentOutput = maxOutput * utilization;

      const parent = node.parentId ? findNode(tree, node.parentId) : null;
      const primaryInp = inputs.find((i) => parent?.node.outputItemKey === i.itemKey);
      const belt = getBelt(node.incomingBeltKey ?? "belt1");
      const beltCapacity = belt?.rate ?? 60;
      const parentSending =
        parent && result.has(parent.id)
          ? ((result.get(parent.id) as FlowRateData)?.currentOutput ?? 0)
          : 0;

      result.set(node.id, {
        parentSending,
        beltCapacity,
        needsInput: primaryInp?.needsInput ?? 0,
        receivesInput: primaryInp?.receivesInput ?? 0,
        inputs: inputs.length > 0 ? inputs : undefined,
        maxOutput,
        currentOutput,
        utilization,
      });

      const outKey = node.node.outputItemKey;
      if (outKey) pools.set(outKey, (pools.get(outKey) ?? 0) + currentOutput);
    }
  }
  return result;
}

/** Produced / consumed rates from the same rules as Storage (per-item mass balance). */
function computeFlowBalanceMaps(
  tree: TreeNode,
  flowRates: Map<string, FlowRateData | { parentSending: number }>
): { produced: Map<KeyName, number>; consumed: Map<KeyName, number> } {
  const produced = new Map<KeyName, number>();
  const consumed = new Map<KeyName, number>();
  for (const t of getAllNodes(tree)) {
    if (!t.node.outputItemKey) continue;
    const outKey = t.node.outputItemKey;
    const fd = flowRates.get(t.id);
    let outputRate: number;
    if (fd && "currentOutput" in fd) {
      outputRate = (fd as FlowRateData).currentOutput;
    } else if (fd && "parentSending" in fd) {
      outputRate = (fd as { parentSending: number }).parentSending;
    } else {
      outputRate =
        getEffectiveOutputPerMachine(t.node) * (t.node.clockPercent / 100) * t.node.count;
    }
    produced.set(outKey, (produced.get(outKey) ?? 0) + outputRate);

    if (t.node.isRaw || !t.node.recipeKey) continue;
    const cfd = flowRates.get(t.id) as FlowRateData | undefined;
    if (!cfd || !("needsInput" in cfd)) continue;
    if (cfd.inputs && cfd.inputs.length > 0) {
      for (const inp of cfd.inputs) {
        consumed.set(inp.itemKey, (consumed.get(inp.itemKey) ?? 0) + inp.receivesInput);
      }
    } else if (cfd.receivesInput > 0) {
      const rIn = getRecipeInputsPerMinute(t.node.recipeKey);
      if (rIn.length === 1) {
        const ik = rIn[0]!.itemKey;
        consumed.set(ik, (consumed.get(ik) ?? 0) + cfd.receivesInput);
      }
    }
  }
  return { produced, consumed };
}

const STORAGE_BALANCE_EPS = 0.35;
const STORAGE_CLOCK_STEP = 5;

function findFirstProducerForItem(tree: TreeNode, itemKey: KeyName): TreeNode | null {
  for (const t of getAllNodes(tree)) {
    if (t.node.outputItemKey === itemKey) return t;
  }
  return null;
}

function tryStepScaleDownProducer(tree: TreeNode, nodeId: string): TreeNode | null {
  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  if (n.count > 1) {
    return updateNodeInTree(tree, nodeId, { count: n.count - 1 });
  }
  if (n.clockPercent > 100) {
    return updateNodeInTree(tree, nodeId, {
      clockPercent: Math.max(100, n.clockPercent - STORAGE_CLOCK_STEP),
    });
  }
  return null;
}

function tryStepScaleUpProducer(
  tree: TreeNode,
  nodeId: string,
  itemKey: KeyName,
  reserves: Readonly<Record<string, number>>
): TreeNode | null {
  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  const b = getEffectiveOutputPerMachine(n);
  if (b <= 0) return null;

  const fr = computeFlowRates(tree);
  const { produced, consumed } = computeFlowBalanceMaps(tree, fr);
  const target = (consumed.get(itemKey) ?? 0) + (reserves[itemKey] ?? 0);
  const sup = produced.get(itemKey) ?? 0;
  if (sup >= target - STORAGE_BALANCE_EPS) return null;

  // Prefer whole machines at 100% before overclocking; snap when clock crosses +1 equivalent machine.
  const equivNow = (n.count * n.clockPercent) / 100;
  if (n.clockPercent > 100.5 && equivNow >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (n.clockPercent <= 100.5) {
    const at100 = n.count * b;
    if (target > at100 + STORAGE_BALANCE_EPS) {
      return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
    }
  }

  const nextClock = Math.min(250, n.clockPercent + STORAGE_CLOCK_STEP);
  const equivIfClock = (n.count * nextClock) / 100;
  if (nextClock > n.clockPercent && equivIfClock >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (n.clockPercent < 250) {
    return updateNodeInTree(tree, nodeId, { clockPercent: nextClock });
  }

  return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
}

/** Remove surplus for `itemKey` without going under downstream demand (first matching producer only). */
function optimizeStorageItemNoWaste(tree: TreeNode, itemKey: KeyName): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  for (let i = 0; i < 100; i++) {
    const fr = computeFlowRates(t);
    const { produced, consumed } = computeFlowBalanceMaps(t, fr);
    const dem = consumed.get(itemKey) ?? 0;
    const sup = produced.get(itemKey) ?? 0;
    if (sup <= dem + STORAGE_BALANCE_EPS) break;
    const anchor = findFirstProducerForItem(t, itemKey);
    if (!anchor) break;
    const next = tryStepScaleDownProducer(t, anchor.id);
    if (!next) break;
    const t2 = recalcTree(synthesizeMissingInputEdges(next));
    const fr2 = computeFlowRates(t2);
    const { produced: p2, consumed: c2 } = computeFlowBalanceMaps(t2, fr2);
    const sup2 = p2.get(itemKey) ?? 0;
    const dem2 = c2.get(itemKey) ?? 0;
    if (sup2 < dem2 - 0.01) break;
    t = t2;
  }
  return t;
}

/** Meet downstream demand + reserve for `itemKey` (scale up first producer). */
function satisfyStorageReserveForItem(
  tree: TreeNode,
  itemKey: KeyName,
  reserves: Readonly<Record<string, number>>
): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  for (let i = 0; i < 100; i++) {
    const fr = computeFlowRates(t);
    const { produced, consumed } = computeFlowBalanceMaps(t, fr);
    const target = (consumed.get(itemKey) ?? 0) + (reserves[itemKey] ?? 0);
    const sup = produced.get(itemKey) ?? 0;
    if (sup >= target - STORAGE_BALANCE_EPS) break;
    const anchor = findFirstProducerForItem(t, itemKey);
    if (!anchor) break;
    const next = tryStepScaleUpProducer(t, anchor.id, itemKey, reserves);
    if (!next) break;
    t = recalcTree(synthesizeMissingInputEdges(next));
  }
  return t;
}

function nodeOutputFromFlow(
  flowRates: Map<string, FlowRateData | { parentSending: number }>,
  nodeId: string
): number {
  const fd = flowRates.get(nodeId);
  if (!fd) return 0;
  if ("currentOutput" in fd) return (fd as FlowRateData).currentOutput ?? 0;
  if ("parentSending" in fd) return (fd as { parentSending: number }).parentSending;
  return 0;
}

/** Max output if fully fed (machines) or extractor theoretical (raw). Do not use {@link nodeOutputFromFlow} for scale-up decisions — it uses utilization and causes runaway machine counts. */
function nodeTheoreticalMaxOutputFromFlow(
  flowRates: Map<string, FlowRateData | { parentSending: number }>,
  nodeId: string
): number {
  const fd = flowRates.get(nodeId);
  if (!fd) return 0;
  if ("maxOutput" in fd && typeof (fd as FlowRateData).maxOutput === "number") {
    return (fd as FlowRateData).maxOutput;
  }
  if ("parentSending" in fd) {
    return (fd as { parentSending: number }).parentSending;
  }
  return 0;
}

/** Smallest belt tier ≥ preferred Mk that still carries `throughputNeeded` (otherwise max of those tiers). */
function pickBeltAtLeastPreferred(throughputNeeded: number, preferredBeltKey: string): string {
  const pref = getBelt(preferredBeltKey);
  const minRate = pref?.rate ?? 60;
  const belts = getAllBelts()
    .filter((b) => b.rate >= minRate)
    .sort((a, b) => a.rate - b.rate);
  if (belts.length === 0) return preferredBeltKey;
  const ok = belts.find((b) => b.rate >= throughputNeeded);
  return ok?.key_name ?? belts[belts.length - 1]!.key_name;
}

function tryStepScaleUpProducerMinOutput(
  tree: TreeNode,
  nodeId: string,
  minOutputRate: number
): TreeNode | null {
  const fr = computeFlowRates(tree);
  const theory = nodeTheoreticalMaxOutputFromFlow(fr, nodeId);
  if (theory >= minOutputRate - STORAGE_BALANCE_EPS) return null;

  const tn = findNode(tree, nodeId);
  if (!tn) return null;
  const n = tn.node;
  const b = getEffectiveOutputPerMachine(n);
  if (b <= 0) return null;

  const equivNow = (n.count * n.clockPercent) / 100;
  if (n.clockPercent > 100.5 && equivNow >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (n.clockPercent <= 100.5) {
    const at100 = n.count * b;
    if (minOutputRate > at100 + STORAGE_BALANCE_EPS) {
      return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
    }
  }

  const nextClock = Math.min(250, n.clockPercent + STORAGE_CLOCK_STEP);
  const equivIfClock = (n.count * nextClock) / 100;
  if (nextClock > n.clockPercent && equivIfClock >= n.count + 1 - 1e-6) {
    return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
  }

  if (n.clockPercent < 250) {
    return updateNodeInTree(tree, nodeId, { clockPercent: nextClock });
  }

  return updateNodeInTree(tree, nodeId, { count: n.count + 1, clockPercent: 100 });
}

function depthFromRoot(tree: TreeNode, nodeId: string): number {
  let d = 0;
  let cur: TreeNode | null = findNode(tree, nodeId);
  while (cur?.parentId) {
    d += 1;
    cur = findNode(tree, cur.parentId);
  }
  return d;
}

/** `startId` plus every machine/miner reachable by following recipe inputs → {@link resolveSupplierIds}. */
function collectUpstreamClosureIds(tree: TreeNode, startId: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const n = findNode(tree, id);
    if (!n || !n.node.recipeKey || n.node.isRaw) return;
    for (const { itemKey } of getRecipeInputsPerMinute(n.node.recipeKey)) {
      for (const sid of resolveSupplierIds(tree, n, itemKey)) {
        visit(sid);
      }
    }
  }
  visit(startId);
  return order;
}

function applyBeltForConsumerInput(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  needThroughput: number,
  preferredBeltKey: string
): TreeNode {
  const consumer = findNode(tree, consumerId);
  if (!consumer) return tree;
  const beltKey = pickBeltAtLeastPreferred(needThroughput, preferredBeltKey);
  const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
  if (parent?.node.outputItemKey === itemKey) {
    return updateChildBeltInTree(tree, parent.id, consumerId, beltKey);
  }
  const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
  if (edge) {
    return updateInputEdgeBeltInTree(tree, consumerId, itemKey, beltKey);
  }
  return tree;
}

function readConsumerInputFlow(
  tree: TreeNode,
  flowRates: Map<string, FlowRateData | { parentSending: number }>,
  consumerId: string,
  itemKey: KeyName
): { needs: number; receives: number } {
  const consumer = findNode(tree, consumerId);
  if (!consumer?.node.recipeKey) return { needs: 0, receives: 0 };
  const base = getRecipeInputsPerMinute(consumer.node.recipeKey).find((x) => x.itemKey === itemKey);
  const needsFallback = (base?.perMinute ?? 0) * consumer.node.count;
  const cfd = flowRates.get(consumerId) as FlowRateData | undefined;
  if (cfd?.inputs && cfd.inputs.length > 0) {
    const row = cfd.inputs.find((i) => i.itemKey === itemKey);
    if (row) return { needs: row.needsInput, receives: row.receivesInput };
  }
  if (cfd && "receivesInput" in cfd) {
    const parent = consumer.parentId ? findNode(tree, consumer.parentId) : null;
    if (parent?.node.outputItemKey === itemKey) {
      return { needs: cfd.needsInput, receives: cfd.receivesInput };
    }
  }
  return { needs: needsFallback, receives: 0 };
}

function scaleSupplierUntilInputFed(
  tree: TreeNode,
  consumerId: string,
  itemKey: KeyName,
  supplierId: string,
  preferredBeltKey: string
): TreeNode {
  let t = tree;
  for (let g = 0; g < 140; g++) {
    t = recalcTree(synthesizeMissingInputEdges(t));
    const consumer = findNode(t, consumerId);
    if (!consumer?.node.recipeKey) break;
    const base = getRecipeInputsPerMinute(consumer.node.recipeKey).find((x) => x.itemKey === itemKey);
    if (!base) break;
    const needThroughput = base.perMinute * consumer.node.count;
    t = applyBeltForConsumerInput(t, consumerId, itemKey, needThroughput, preferredBeltKey);
    t = recalcTree(synthesizeMissingInputEdges(t));

    const fr = computeFlowRates(t);
    const { needs, receives } = readConsumerInputFlow(t, fr, consumerId, itemKey);
    if (needs <= 0) break;
    if (receives >= needs - STORAGE_BALANCE_EPS) break;

    // If the supplier already has enough *capacity*, low receives are belt/pool/upstream — do not add machines.
    const supplierTheory = nodeTheoreticalMaxOutputFromFlow(fr, supplierId);
    if (supplierTheory >= needs - STORAGE_BALANCE_EPS) break;

    const stepped = tryStepScaleUpProducerMinOutput(t, supplierId, needs);
    if (!stepped) break;
    t = stepped;
  }
  return t;
}

/** For one machine: every recipe input → resolve suppliers (parent, edges, slices), belts, scale suppliers until sim feeds it. */
function autoBalanceAllInputsForNode(
  tree: TreeNode,
  consumerId: string,
  preferredBeltKey: string
): TreeNode {
  let t = tree;
  const consumer = findNode(t, consumerId);
  if (!consumer || consumer.node.isRaw || !consumer.node.recipeKey) return t;

  for (const { itemKey, perMinute } of getRecipeInputsPerMinute(consumer.node.recipeKey)) {
    if (perMinute <= 0) continue;
    const needThroughput = perMinute * consumer.node.count;
    const suppliers = resolveSupplierIds(t, consumer, itemKey);
    if (suppliers.length === 0) continue;

    const parent = consumer.parentId ? findNode(t, consumer.parentId) : null;
    const edge = consumer.inputEdges?.find((e) => e.itemKey === itemKey);
    const primary =
      parent?.node.outputItemKey === itemKey
        ? parent.id
        : edge?.producerId;
    const orderedSuppliers = primary
      ? [primary, ...suppliers.filter((id) => id !== primary)]
      : suppliers;

    t = applyBeltForConsumerInput(t, consumerId, itemKey, needThroughput, preferredBeltKey);

    for (const supplierId of orderedSuppliers) {
      t = scaleSupplierUntilInputFed(t, consumerId, itemKey, supplierId, preferredBeltKey);
      t = recalcTree(synthesizeMissingInputEdges(t));
      const fr = computeFlowRates(t);
      const { needs, receives } = readConsumerInputFlow(t, fr, consumerId, itemKey);
      if (needs > 0 && receives >= needs - STORAGE_BALANCE_EPS) break;
    }
  }
  return t;
}

/**
 * Auto-balance after an edit: walk the upstream closure from `startNodeId` (recipe consumers only), shallow→deep,
 * repeatedly satisfying every input via {@link resolveSupplierIds} (not only tree parent). Fixes multi-input machines
 * (e.g. Encased Industrial Beam: steel beam + concrete from edges / other slices).
 */
function autoBalanceAfterEdit(
  tree: TreeNode,
  startNodeId: string,
  preferredBeltKey: string
): TreeNode {
  let t = recalcTree(synthesizeMissingInputEdges(tree));
  const closure = collectUpstreamClosureIds(t, startNodeId);
  const consumerIds = closure.filter((id) => {
    const n = findNode(t, id);
    return Boolean(n && !n.node.isRaw && n.node.recipeKey);
  });
  consumerIds.sort((a, b) => depthFromRoot(t, a) - depthFromRoot(t, b));

  for (let round = 0; round < 10; round++) {
    t = recalcTree(synthesizeMissingInputEdges(t));
    for (const cid of consumerIds) {
      t = autoBalanceAllInputsForNode(t, cid, preferredBeltKey);
    }
  }
  return recalcTree(synthesizeMissingInputEdges(t));
}

/** @deprecated Use {@link autoBalanceAfterEdit}; kept name for call sites. */
function autoBalanceAncestorChain(
  tree: TreeNode,
  leafId: string,
  preferredBeltKey: string
): TreeNode {
  return autoBalanceAfterEdit(tree, leafId, preferredBeltKey);
}

function recalcTree(tree: TreeNode): TreeNode {
  function recalc(t: TreeNode): TreeNode {
    const recalcChildren = t.children.map(recalc);
    const node = { ...t.node };

    if (t.children.length === 0) {
      node.totalOutput =
        getEffectiveOutputPerMachine(node) * (node.clockPercent / 100) * node.count;
      return { ...t, node, children: [] };
    }

    const supplyPerMachine = getEffectiveOutputPerMachine(node) * (node.clockPercent / 100);
    node.totalOutput = supplyPerMachine * node.count;

    return { ...t, node, children: recalcChildren };
  }
  return recalc(tree);
}


const EMPTY_TREE = createTreeNode(createNode("", "", "", 0, 0, 100, {}), null);

/** Build TreeNode from a linear chain (for slices starter) */
function buildTreeFromChain(
  chain: { itemKey: KeyName; recipeKey: string }[],
  targetOutput: number,
  minerKey = "miner-mk1"
): TreeNode {
  const steps = computeChainFromOutput(chain, targetOutput, minerKey);
  if (steps.length === 0) return EMPTY_TREE;
  const nodes: TreeNode[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s) continue;
    const building = getBuilding(s.buildingKey);
    const recipe = s.recipeKey !== "_raw_" ? getRecipe(s.recipeKey) : null;
    const buildingName = building?.name ?? (recipe ? getBuildingForRecipe(recipe)?.name : null) ?? s.buildingKey;
    const recipeName = recipe?.name ?? getItemName(s.itemKey);
    const node = createNode(
      s.itemKey,
      s.buildingKey,
      buildingName,
      s.outputPerMachine,
      s.machineCount,
      100,
      {
        recipeKey: s.recipeKey !== "_raw_" ? s.recipeKey : undefined,
        recipeName,
        inputPerMachine: s.inputPerMachine,
        isRaw: s.isRaw,
      }
    );
    const parentId = i > 0 ? nodes[i - 1]!.id : null;
    const tn = createTreeNode(node, parentId, [], pickDefaultBelt(s.inputPerMachine * s.machineCount));
    nodes.push(tn);
  }
  for (let i = nodes.length - 1; i >= 1; i--) {
    const child = nodes[i]!;
    const parent = nodes[i - 1]!;
    nodes[i - 1] = { ...parent, children: [...parent.children, child] };
  }
  return nodes[0] ?? EMPTY_TREE;
}

/** Deepest node following the first child at each level (linear chain trees). */
function getDeepestDescendantId(root: TreeNode): string {
  let cur: TreeNode = root;
  while (cur.children.length > 0) {
    cur = cur.children[0]!;
  }
  return cur.id;
}

export function FlowChart() {
  const [tree, setTree] = useState<TreeNode>(EMPTY_TREE);
  const [currentChartId, setCurrentChartId] = useState<string | null>(null);
  const [currentChartName, setCurrentChartName] = useState<string>("Untitled");
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [buildInventoryOpen, setBuildInventoryOpen] = useState(false);
  /** Default horizontal; vertical layout kept in menu for now (deprecated path). */
  const [layout, setLayout] = useState<"vertical" | "horizontal">("horizontal");
  const [separateAction, setSeparateAction] = useState<(() => void) | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [storageReserves, setStorageReserves] = useState<Record<string, number>>({});
  const [autoBalanceEnabled, setAutoBalanceEnabled] = useState(false);
  const [preferredBeltKey, setPreferredBeltKey] = useState("belt4");

  useEffect(() => {
    const saved = getSavedCharts();
    setCharts(saved);
    const lastId = getLastChartId();
    if (lastId) {
      const loaded = loadChart(lastId);
      if (loaded) {
        setTree(recalcTree(synthesizeMissingInputEdges(loaded.tree)));
        setStorageReserves(loaded.storageReserves);
        setAutoBalanceEnabled(loaded.autoBalanceEnabled);
        setPreferredBeltKey(loaded.preferredBeltKey);
        const c = saved.find((x) => x.id === lastId);
        setCurrentChartId(lastId);
        setCurrentChartName(c?.name ?? "Untitled");
      }
    }
  }, []);

  const loadChartById = useCallback((id: string) => {
    const loaded = loadChart(id);
    if (loaded) {
      setTree(recalcTree(synthesizeMissingInputEdges(loaded.tree)));
      setStorageReserves(loaded.storageReserves);
      setAutoBalanceEnabled(loaded.autoBalanceEnabled);
      setPreferredBeltKey(loaded.preferredBeltKey);
      setCurrentChartId(id);
      const saved = getSavedCharts();
      const c = saved.find((x) => x.id === id);
      setCurrentChartName(c?.name ?? "Untitled");
    }
  }, []);

  const chartExtras = useMemo(
    () => ({
      storageReserves,
      autoBalanceEnabled,
      preferredBeltKey,
    }),
    [storageReserves, autoBalanceEnabled, preferredBeltKey]
  );

  const handleNewChart = useCallback(() => {
    setTree(EMPTY_TREE);
    setCurrentChartId(null);
    setCurrentChartName("Untitled");
    setStorageReserves({});
    setAutoBalanceEnabled(false);
    setPreferredBeltKey("belt4");
  }, []);

  const handleSave = useCallback(() => {
    if (currentChartId) {
      saveChart(currentChartId, currentChartName, tree, chartExtras);
      setCharts(getSavedCharts());
    } else {
      setSaveAsOpen(true);
    }
  }, [currentChartId, currentChartName, tree, chartExtras]);

  const handleSaveAs = useCallback(
    (name: string) => {
      const id = generateChartId();
      saveChart(id, name, tree, chartExtras);
      setCurrentChartId(id);
      setCurrentChartName(name);
      setCharts(getSavedCharts());
      setSaveAsOpen(false);
    },
    [tree, chartExtras]
  );

  const handleDeleteChart = useCallback((id: string) => {
    deleteChart(id);
    setCharts(getSavedCharts());
    if (currentChartId === id) {
      const remaining = getSavedCharts();
      if (remaining.length > 0) {
        loadChartById(remaining[0].id);
      } else {
        setTree(EMPTY_TREE);
        setCurrentChartId(null);
        setCurrentChartName("Untitled");
        setStorageReserves({});
        setAutoBalanceEnabled(false);
        setPreferredBeltKey("belt4");
      }
    }
  }, [currentChartId, loadChartById]);

  const isEmpty = !tree.node.outputItemKey;

  const addMachine = useCallback(
    (
      parentTreeNode: TreeNode,
      option: {
        recipeKey: string;
        recipeName: string;
        buildingKey: string;
        buildingName: string;
        outputItemKey: KeyName;
        outputPerMachine: number;
        inputPerMachine: number;
      },
      insertAtIndex?: number,
      inputEdges?: InputEdge[]
    ) => {
      const isExtractor = (option.inputPerMachine ?? 0) === 0;
      const n = createNode(
        option.outputItemKey,
        option.buildingKey,
        option.buildingName,
        option.outputPerMachine,
        1,
        100,
        {
          recipeKey: option.recipeKey,
          recipeName: option.recipeName,
          inputPerMachine: option.inputPerMachine,
          isRaw: isExtractor,
        }
      );

      if (!parentTreeNode.node.outputItemKey) {
        setTree(createTreeNode(n, null, []));
        return;
      }

      const siblingOutputs = parentTreeNode.children.map((c) => c.node.outputItemKey);
      const isBranch = siblingOutputs.includes(option.outputItemKey);
      const idx = insertAtIndex ?? (isBranch ? 0 : parentTreeNode.children.length);
      let updated = addChildToNode(tree, parentTreeNode.id, n, idx, inputEdges);
      updated = recalcTree(synthesizeMissingInputEdges(updated));
      if (autoBalanceEnabled) {
        updated = autoBalanceAncestorChain(updated, n.id, preferredBeltKey);
      }
      setTree(updated);
    },
    [tree, autoBalanceEnabled, preferredBeltKey]
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<FlowNode>) => {
      let updated = updateNodeInTree(tree, nodeId, updates);
      updated = recalcTree(updated);
      if (autoBalanceEnabled) {
        updated = autoBalanceAncestorChain(updated, nodeId, preferredBeltKey);
      }
      setTree(updated);
    },
    [tree, autoBalanceEnabled, preferredBeltKey]
  );

  const setNodeMachine = useCallback(
    (nodeId: string, option: MachineOption) => {
      updateNode(nodeId, {
        outputItemKey: option.outputItemKey,
        outputItemName: getItemName(option.outputItemKey),
        buildingKey: option.buildingKey,
        buildingName: option.buildingName,
        outputPerMachine: option.outputPerMachine,
        recipeKey: option.recipeKey,
        recipeName: option.recipeName,
        inputPerMachine: option.inputPerMachine,
      });
    },
    [updateNode]
  );

  const removeNode = useCallback(
    (parentId: string | null, nodeId: string) => {
      if (!parentId) return;
      const parent = findNode(tree, parentId);
      if (!parent) return;
      const newChildren = parent.children.filter((c) => c.id !== nodeId);
      const updated = replaceNode(tree, parentId, (t) => ({
        ...t,
        children: newChildren,
      }));
      setTree(recalcTree(updated));
    },
    [tree]
  );

  const updateChildBelt = useCallback((parentId: string, childId: string, incomingBeltKey: string) => {
    setTree((t) => updateChildBeltInTree(t, parentId, childId, incomingBeltKey));
  }, []);

  const updateInputEdgeBelt = useCallback((consumerId: string, itemKey: KeyName, beltKey: string) => {
    setTree((t) => updateInputEdgeBeltInTree(t, consumerId, itemKey, beltKey));
  }, []);

  const mergeNodes = useCallback(
    (parentId: string, leftId: string, rightId: string) => {
      setTree(recalcTree(mergeNodesAsChild(tree, parentId, leftId, rightId)));
    },
    [tree]
  );

  const splitNodeHandler = useCallback(
    (parentId: string, nodeId: string) => {
      setTree(recalcTree(splitMergedNode(tree, parentId, nodeId)));
    },
    [tree]
  );

  const flowRates = useMemo(
    () => (tree.node.outputItemKey ? computeFlowRates(tree) : new Map()),
    [tree]
  );

  const [flowHoverNodeId, setFlowHoverNodeId] = useState<string | null>(null);
  const [flowPinnedNodeId, setFlowPinnedNodeId] = useState<string | null>(null);
  /** Pinned node locks the branch highlight; hover only applies when nothing is pinned */
  const flowFocusNodeId = flowPinnedNodeId ?? flowHoverNodeId;
  const flowFocusRelatedIds = useMemo(
    () =>
      flowFocusNodeId ? getRelatedNodeIdsForHover(tree, flowFocusNodeId) : EMPTY_FLOW_RELATED_IDS,
    [tree, flowFocusNodeId]
  );
  const toggleFlowPin = useCallback((id: string) => {
    setFlowPinnedNodeId((prev) => {
      if (prev === id) return null;
      if (prev != null) return prev;
      return id;
    });
  }, []);

  useEffect(() => {
    if (flowPinnedNodeId && !findNode(tree, flowPinnedNodeId)) {
      setFlowPinnedNodeId(null);
    }
  }, [tree, flowPinnedNodeId]);

  const buildInventory = useMemo(() => computeBuildInventory(tree), [tree]);

  const storageRows = useMemo((): StorageStripRow[] => {
    if (!tree.node.outputItemKey) return [];
    const balance = computeFlowBalanceMaps(tree, flowRates);
    const keys = new Set<KeyName>();
    for (const [k, v] of balance.produced) {
      if (v > 1e-6) keys.add(k);
    }
    for (const k of Object.keys(storageReserves)) {
      if ((storageReserves[k] ?? 0) > 0) keys.add(k as KeyName);
    }
    return [...keys]
      .sort((a, b) => getItemName(a).localeCompare(getItemName(b)))
      .map((itemKey) => ({
        itemKey,
        itemName: getItemName(itemKey),
        surplusRate: Math.max(
          0,
          (balance.produced.get(itemKey) ?? 0) - (balance.consumed.get(itemKey) ?? 0)
        ),
        reservePerMin: storageReserves[itemKey as string] ?? 0,
      }));
  }, [tree, flowRates, storageReserves]);

  const adjustStorageReserve = useCallback((itemKey: KeyName, delta: number) => {
    setStorageReserves((prev) => {
      const cur = prev[itemKey as string] ?? 0;
      const n = Math.max(0, cur + delta);
      const next: Record<string, number> = { ...prev };
      if (n <= 0) delete next[itemKey as string];
      else next[itemKey as string] = n;
      queueMicrotask(() => {
        setTree((t0) =>
          n > 0
            ? satisfyStorageReserveForItem(t0, itemKey, next)
            : optimizeStorageItemNoWaste(t0, itemKey)
        );
      });
      return next;
    });
  }, []);

  const optimizeStorageRow = useCallback((itemKey: KeyName) => {
    setStorageReserves((prev) => {
      const next = { ...prev };
      delete next[itemKey as string];
      queueMicrotask(() => {
        setTree((t0) => optimizeStorageItemNoWaste(t0, itemKey));
      });
      return next;
    });
  }, []);

  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [quickBuildOpen, setQuickBuildOpen] = useState(false);
  const [quickBuildKey, setQuickBuildKey] = useState(0);
  const [quickBuildError, setQuickBuildError] = useState<string | null>(null);

  const handleQuickBuildConfirm = useCallback(
    (args: { productKey: KeyName; recipeKey: string; minerKey: string }) => {
      setQuickBuildError(null);
      const planned = planProductionFromTarget(
        { productKey: args.productKey, recipeKey: args.recipeKey },
        { minerKey: args.minerKey }
      );
      if (!planned.ok) {
        setQuickBuildError(planned.error);
        return;
      }
      try {
        const { tree, targetNodeId } = productionPlanToSliceTree(planned.plan);
        let t = recalcTree(synthesizeMissingInputEdges(tree));
        t = autoBalanceAfterEdit(t, targetNodeId, preferredBeltKey);
        setTree(t);
        setAutoBalanceEnabled(true);
        setQuickBuildOpen(false);
      } catch (e) {
        setQuickBuildError(e instanceof Error ? e.message : "Failed to layout factory from plan.");
      }
    },
    [preferredBeltKey]
  );

  const storageStrip = (
    <StorageStrip
      rows={storageRows}
      onReserveDelta={adjustStorageReserve}
      onOptimizeRow={optimizeStorageRow}
    />
  );

  const header = (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-900/30">
      <div className="flex w-full items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          {isEmpty ? (
            <p className="text-sm text-zinc-500">Add a machine to start</p>
          ) : (
            <h1 className="truncate text-lg font-medium text-zinc-200">{currentChartName}</h1>
          )}
        </div>
        <div className="relative flex items-center gap-1">
          {separateAction && (
            <button
              type="button"
              onClick={() => { separateAction(); setSeparateAction(null); }}
              className="rounded-lg p-2 text-amber-400 hover:bg-zinc-800 hover:text-amber-300"
              title="Separate"
              aria-label="Separate"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {menuOpen &&
            typeof document !== "undefined" &&
            createPortal(
              (() => {
                const rect = menuButtonRef.current?.getBoundingClientRect();
                return (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      className="fixed z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border-2 border-zinc-700 bg-zinc-900 p-2 shadow-xl"
                      style={
                        rect
                          ? { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                          : undefined
                      }
                    >
                {buildInventory && buildInventory.buildings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBuildInventoryOpen(true);
                      setMenuOpen(false);
                    }}
                    className="mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Build inventory…
                  </button>
                )}
                <select
                  value={currentChartId ?? "__unsaved__"}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && id !== "__unsaved__") loadChartById(id);
                    setMenuOpen(false);
                  }}
                  className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="__unsaved__">{currentChartName}{!currentChartId ? " (unsaved)" : ""}</option>
                  {charts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="mb-2 flex gap-1 rounded-lg border border-zinc-700 p-1">
                  <button
                    type="button"
                    onClick={() => { setLayout("vertical"); setMenuOpen(false); }}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${layout === "vertical" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    ↓ Vertical
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLayout("horizontal"); setMenuOpen(false); }}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${layout === "horizontal" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    → Horizontal
                  </button>
                </div>
                <div className="mb-2 rounded-lg border border-zinc-700 p-2">
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={autoBalanceEnabled}
                      onChange={(e) => setAutoBalanceEnabled(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-600"
                    />
                    <span>
                      <span className="font-medium text-zinc-200">Auto-balance</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        After adds or edits, scale tree ancestors (parent→root) to meet belted demand. Surplus OK.
                      </span>
                    </span>
                  </label>
                  <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Min belt tier
                  </label>
                  <select
                    value={preferredBeltKey}
                    onChange={(e) => setPreferredBeltKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
                  >
                    {BELTS.map((b) => (
                      <option key={b.key_name} value={b.key_name}>
                        {b.name} ({formatRate(b.rate)}/min)
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => { handleNewChart(); setMenuOpen(false); }}
                  className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  New
                </button>
                <button
                  type="button"
                  onClick={() => { handleSave(); setMenuOpen(false); }}
                  className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setSaveAsOpen(true); setMenuOpen(false); }}
                  className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Save as
                </button>
                {currentChartId && charts.some((c) => c.id === currentChartId) && (
                  <button
                    type="button"
                    onClick={() => { handleDeleteChart(currentChartId); setMenuOpen(false); }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
                    </div>
                  </>
                );
              })(),
              document.body
            )
          }
        </div>
      </div>
      {saveAsOpen && (
        <SaveAsModal
          currentName={currentChartName}
          onSave={handleSaveAs}
          onClose={() => setSaveAsOpen(false)}
        />
      )}
      {buildInventoryOpen && buildInventory && buildInventory.buildings.length > 0 && (
        <BuildInventoryModal
          buildings={buildInventory.buildings}
          powerShards={buildInventory.powerShards}
          onClose={() => setBuildInventoryOpen(false)}
        />
      )}
    </header>
  );

  if (isEmpty && layout !== "horizontal") {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {header}
          <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <main className="min-h-0 min-w-0 flex-1 overflow-auto">
              <div className="flex min-h-0 min-w-0 items-center justify-center p-6">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => setAddMachineOpen(true)}
                    className={`flex min-h-[120px] min-w-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 transition ${addMachineOpen ? "border-amber-500/60 bg-zinc-800" : "border-dashed border-zinc-600 bg-zinc-900/50 hover:border-amber-500/40 hover:bg-zinc-800/80"}`}
                  >
                    <span className="text-3xl font-light text-zinc-400">+</span>
                    <span className="text-center text-sm font-medium text-zinc-400">Add machine</span>
                  </button>
                  {addMachineOpen && (
                    <AddMachineModal
                      title="Add machine"
                      options={getExtractorMachineOptions()}
                      onSelect={(opt) => {
                        addMachine(tree, opt);
                        setAddMachineOpen(false);
                      }}
                      onClose={() => setAddMachineOpen(false)}
                    />
                  )}
                </div>
              </div>
            </main>
            {storageStrip}
          </div>
        </div>
        <QuickBuildFab
          onClick={() => {
            setQuickBuildError(null);
            setQuickBuildKey((k) => k + 1);
            setQuickBuildOpen(true);
          }}
        />
        <QuickBuildModal
          key={quickBuildKey}
          open={quickBuildOpen}
          onClose={() => setQuickBuildOpen(false)}
          onConfirm={handleQuickBuildConfirm}
          error={quickBuildError}
          hasExistingChart={false}
        />
      </>
    );
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {header}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div
            className={`flex min-h-0 min-w-0 p-6 ${layout === "horizontal" ? "min-h-full w-fit items-stretch justify-start" : "items-center justify-center"}`}
          >
            <div className={layout === "horizontal" ? "flex min-h-full flex-1 flex-row items-stretch justify-start" : "flex flex-col items-center"}>
      {layout === "horizontal" ? (
        <TreeLevelSlices
          treeNode={tree}
          tree={tree}
          flowRates={flowRates}
          machineOptions={
            tree.node.outputItemKey
              ? (tree.node.isRaw ? getExtractorMachineOptionsFull() : getMachineOptionsForInput(tree.node.outputItemKey))
              : []
          }
          parentOutputItemKey={undefined}
          onUpdateNode={updateNode}
          onSelectNodeMachine={setNodeMachine}
          onAddMachine={addMachine}
          onUpdateChildBelt={updateChildBelt}
          onUpdateInputEdgeBelt={updateInputEdgeBelt}
          onMergeNodes={mergeNodes}
          onSplitNode={splitNodeHandler}
          onRemove={undefined}
          removeNode={removeNode}
          onSetSeparateAction={setSeparateAction}
          onSeedStarter={(t) => {
            let next = recalcTree(synthesizeMissingInputEdges(t));
            const leafId = getDeepestDescendantId(next);
            next = autoBalanceAfterEdit(next, leafId, preferredBeltKey);
            setTree(next);
            setAutoBalanceEnabled(true);
          }}
          flowFocusNodeId={flowFocusNodeId}
          flowFocusRelatedIds={flowFocusRelatedIds}
          onFlowNodeHoverEnter={setFlowHoverNodeId}
          onFlowNodeHoverLeave={() => setFlowHoverNodeId(null)}
          onFlowNodePinToggle={toggleFlowPin}
        />
      ) : (
        <TreeLevel
          treeNode={tree}
          tree={tree}
          flowRates={flowRates}
          machineOptions={
            tree.node.isRaw
              ? getExtractorMachineOptionsFull()
              : getMachineOptionsForInput(tree.node.outputItemKey)
          }
          parentOutputItemKey={undefined}
          onUpdateNode={updateNode}
          onSelectNodeMachine={setNodeMachine}
          onAddMachine={addMachine}
          onUpdateChildBelt={updateChildBelt}
          onMergeNodes={mergeNodes}
          onSplitNode={splitNodeHandler}
          onRemove={undefined}
          removeNode={removeNode}
          onSetSeparateAction={setSeparateAction}
          flowFocusNodeId={flowFocusNodeId}
          flowFocusRelatedIds={flowFocusRelatedIds}
          onFlowNodeHoverEnter={setFlowHoverNodeId}
          onFlowNodeHoverLeave={() => setFlowHoverNodeId(null)}
          onFlowNodePinToggle={toggleFlowPin}
        />
      )}
            </div>
          </div>
        </main>
        {storageStrip}
      </div>
    </div>
    <QuickBuildFab
      onClick={() => {
        setQuickBuildError(null);
        setQuickBuildKey((k) => k + 1);
        setQuickBuildOpen(true);
      }}
    />
    <QuickBuildModal
      key={quickBuildKey}
      open={quickBuildOpen}
      onClose={() => setQuickBuildOpen(false)}
      onConfirm={handleQuickBuildConfirm}
      error={quickBuildError}
      hasExistingChart={!isEmpty}
    />
    </>
  );
}

interface TreeLevelProps {
  treeNode: TreeNode;
  tree: TreeNode;
  flowRates: Map<string, FlowRateData | { parentSending: number }>;
  machineOptions: MachineOption[];
  parentOutputItemKey?: KeyName;
  onUpdateNode: (nodeId: string, u: Partial<FlowNode>) => void;
  onSelectNodeMachine: (nodeId: string, opt: MachineOption) => void;
  onAddMachine: (parent: TreeNode, option: MachineOption, insertAtIndex?: number, inputEdges?: InputEdge[]) => void;
  onUpdateChildBelt: (parentId: string, childId: string, incomingBeltKey: string) => void;
  onUpdateInputEdgeBelt?: (consumerId: string, itemKey: KeyName, beltKey: string) => void;
  onMergeNodes?: (parentId: string, leftId: string, rightId: string) => void;
  onSplitNode?: (parentId: string, nodeId: string) => void;
  parentId?: string | null;
  incomingBeltKey?: string;
  onUpdateBelt?: (beltKey: string) => void;
  onRemove?: () => void;
  removeNode: (parentId: string | null, nodeId: string) => void;
  onSetSeparateAction?: (action: (() => void) | null) => void;
  compactSlice?: boolean;
  onSeedStarter?: (tree: TreeNode) => void;
  /** Focus node for upstream highlight (pinned click locks until unpinned; hover only when unpinned) */
  flowFocusNodeId?: string | null;
  flowFocusRelatedIds?: Set<string>;
  onFlowNodeHoverEnter?: (treeNodeId: string) => void;
  onFlowNodeHoverLeave?: () => void;
  /** Click a machine card to pin its supply branch until cleared */
  onFlowNodePinToggle?: (treeNodeId: string) => void;
}

function TreeLevel({
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
            value={incomingBeltKey ?? "belt1"}
            onChange={onUpdateBelt}
            beltCapacity={flowDataForBelt.beltCapacity}
            receivesInput={flowDataForBelt.receivesInput}
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

function TreeLevelHorizontal(props: TreeLevelProps) {
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
    <div className="flex min-w-[200px] w-[200px] shrink-0 justify-center">
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
            value={incomingBeltKey ?? "belt1"}
            onChange={onUpdateBelt!}
            beltCapacity={flowDataForBelt.beltCapacity}
            receivesInput={flowDataForBelt.receivesInput}
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
                            value={children[0]?.incomingBeltKey ?? "belt1"}
                            onChange={() => {}}
                            beltCapacity={maxBeltCapacity}
                            receivesInput={summedReceives}
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

/** One belt / input row above a machine in horizontal slice view */
type SliceBeltRow = {
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
function TreeLevelSlices(props: TreeLevelProps) {
  const {
    tree,
    flowRates,
    machineOptions,
    onUpdateNode,
    onSelectNodeMachine,
    onAddMachine,
    onUpdateChildBelt,
    onUpdateInputEdgeBelt,
    onMergeNodes,
    removeNode,
    flowFocusNodeId = null,
    flowFocusRelatedIds = EMPTY_FLOW_RELATED_IDS,
    onFlowNodeHoverEnter,
    onFlowNodeHoverLeave,
    onFlowNodePinToggle,
  } = props;

  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [addMachineParent, setAddMachineParent] = useState<TreeNode | null>(null);
  const [addMachineInsertIndex, setAddMachineInsertIndex] = useState<number | undefined>(undefined);
  const [addMachineSliceIdx, setAddMachineSliceIdx] = useState(0);
  const [addMachinePrevSlice, setAddMachinePrevSlice] = useState<TreeNode[] | null>(null);
  const [addMachineAllPrevSlices, setAddMachineAllPrevSlices] = useState<TreeNode[][] | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState<Set<number>>(new Set());
  const [outputExpanded, setOutputExpanded] = useState<Set<number>>(new Set());

  if (!tree.node.outputItemKey) {
    return (
      <div className="flex flex-row items-center gap-4 py-12">
        <button
          type="button"
          onClick={() => {
            const chain = buildChain("iron-plate");
            if (chain && props.onSeedStarter) {
              const lastStep = chain[chain.length - 1]!;
              let oneMachineRate = 60;
              if (lastStep.recipeKey !== "_raw_") {
                const r = getRecipe(lastStep.recipeKey);
                if (r) {
                  const { products } = recipePerMinute(r);
                  oneMachineRate = products.find(([k]) => k === lastStep.itemKey)?.[1] ?? 60;
                }
              }
              const starterTree = buildTreeFromChain(chain, oneMachineRate, "miner-mk2");
              props.onSeedStarter(starterTree);
            } else {
              setAddMachineParent(tree);
              setAddMachineInsertIndex(0);
              setAddMachineOpen(true);
            }
          }}
          className="flex min-h-[120px] min-w-[200px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-600 bg-zinc-900/50 p-6 transition hover:border-amber-500/40 hover:bg-zinc-800/80"
        >
          <span className="text-3xl font-light text-zinc-400">+</span>
          <span className="text-center text-sm font-medium text-zinc-400">Add machine or load Iron Plates chain</span>
        </button>
        {addMachineOpen && (
          <AddMachineModal
            title="Add machine"
            options={getExtractorMachineOptionsFull()}
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

  const slices = getFlowSlices(tree);
  const isEmpty = slices.length === 0;

  if (isEmpty) return null;

  const childOptions = (parent: TreeNode, sliceIdx: number, allPrevSlices: TreeNode[][]) => {
    let opts: MachineOption[];
    if (!parent.node.outputItemKey) opts = getExtractorMachineOptionsFull();
    else if (sliceIdx === 0 && parent.node.isRaw) {
      const extractors = getExtractorMachineOptionsFull();
      const consumers = getMachineOptionsForInput(parent.node.outputItemKey);
      opts = [...extractors, ...consumers];
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
    } else {
      opts = getMachineOptionsForInput(parent.node.outputItemKey);
    }
    return sortOptionsNonAltFirst(opts);
  };

  return (
    <div className="flex h-full min-h-full flex-row items-stretch gap-0">
      {slices.map((sliceNodes, sliceIdx) => {
        const prevSlice = sliceIdx > 0 ? slices[sliceIdx - 1]! : null;
        const parentOutputItemKey = prevSlice?.[0]?.node.outputItemKey;
        const hasInputs = sliceIdx > 0 && prevSlice && prevSlice.length > 0;

        const inputsByItem = new Map<KeyName, { rate: number; consumers: SliceBeltRow[] }>();
        if (hasInputs && sliceIdx > 0) {
          const allPrevSlices = slices.slice(0, sliceIdx);
          let totalRateByItem = new Map<KeyName, number>();
          for (const slice of allPrevSlices) {
            for (const node of slice) {
              const fd = flowRates.get(node.id) as FlowRateData | undefined;
              const rate =
                fd && "currentOutput" in fd
                  ? fd.currentOutput
                  : getEffectiveOutputPerMachine(node.node) * (node.node.clockPercent / 100) * node.node.count;
              const itemKey = node.node.outputItemKey as KeyName;
              if (!itemKey) continue;
              totalRateByItem.set(itemKey, (totalRateByItem.get(itemKey) ?? 0) + rate);
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
                let beltKey = "belt1";
                let beltCapacity = 0;
                let parentSending = 0;
                if (edge) {
                  beltKey = edge.beltKey;
                  const b = getBelt(edge.beltKey);
                  beltCapacity = b?.rate ?? 60;
                  const prodFd = flowRates.get(edge.producerId) as FlowRateData | undefined;
                  parentSending = prodFd && "currentOutput" in prodFd ? prodFd.currentOutput : 0;
                } else if (fromParent) {
                  beltKey = consumer.incomingBeltKey ?? "belt1";
                  const consumerFd = flowRates.get(consumer.id) as FlowRateData | undefined;
                  beltCapacity = consumerFd && "beltCapacity" in consumerFd ? consumerFd.beltCapacity : 0;
                  parentSending = consumerFd && "parentSending" in consumerFd ? consumerFd.parentSending : 0;
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
            if (consumers.length > 0) {
              inputsByItem.set(itemKey, { rate, consumers });
            }
          }
        }

        const outputsByItem = new Map<KeyName, number>();
        for (const node of sliceNodes) {
          const fd = flowRates.get(node.id) as FlowRateData | undefined;
          if (fd && "currentOutput" in fd) {
            const k = node.node.outputItemKey;
            outputsByItem.set(k, (outputsByItem.get(k) ?? 0) + fd.currentOutput);
          }
        }

        const allConsumers: SliceBeltRow[] = Array.from(inputsByItem.values()).flatMap(({ consumers }) => consumers);
        const hasAnyRed = allConsumers.some((c) => c.isBeltLimited);
        const hasAnyYellow = allConsumers.some((c) => c.isUnderfed && !c.isBeltLimited);
        const isExpanded = headerExpanded.has(sliceIdx);
        const hasMoreThanTwoLines = inputsByItem.size > 2;
        const beltsByNodeId = new Map<string, SliceBeltRow[]>();
        for (const c of allConsumers) {
          const list = beltsByNodeId.get(c.nodeId) ?? [];
          list.push(c);
          beltsByNodeId.set(c.nodeId, list);
        }

        return (
          <Fragment key={sliceIdx}>
            <div className="relative flex min-h-full min-w-[220px] max-w-[220px] flex-col overflow-visible border-x border-dashed border-zinc-600">
              {/* Header: inputs + belt per product - fixed height, expand shows overlay */}
              <div
                className={`relative flex shrink-0 flex-col overflow-visible border-b transition ${
                  hasAnyRed ? "border-red-500/60 bg-red-950/20" : hasAnyYellow ? "border-amber-500/50 bg-amber-950/20" : "border-zinc-800"
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
                <div className="h-[5.5rem] overflow-hidden px-2 py-2">
                  {hasMoreThanTwoLines && isExpanded ? (
                    <div className="h-full" aria-hidden />
                  ) : (
                  <div className={`flex h-full flex-col gap-1.5 overflow-hidden ${hasMoreThanTwoLines ? "max-h-full" : ""}`}>
                  {/* Amounts only (rate + item name) - belt selectors are on machine cards */}
                  {Array.from(inputsByItem.entries()).map(([itemKey, { rate, consumers }]) =>
                    consumers.length === 0 ? (
                      <div key={itemKey} className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                        <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                        <span className="ml-auto text-zinc-500">+ to use</span>
                      </div>
                    ) : (
                      <div key={`amt-${itemKey}`} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                        <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                      </div>
                    )
                  )}
                {inputsByItem.size === 0 && sliceIdx === 0 && (
                  <div className="py-1 text-xs text-zinc-500">Input (raw)</div>
                )}
                </div>
                  )}
                </div>
                {hasMoreThanTwoLines && isExpanded && (
                  <div
                    className={`absolute left-0 right-0 top-8 z-50 flex max-h-[85vh] flex-col gap-1.5 overflow-y-auto border border-zinc-700 bg-zinc-900 p-2 shadow-xl ${
                      hasAnyRed ? "border-t-red-500/60" : hasAnyYellow ? "border-t-amber-500/50" : "border-t-zinc-800"
                    }`}
                  >
                    {Array.from(inputsByItem.entries()).map(([itemKey, { rate, consumers }]) =>
                      consumers.length === 0 ? (
                        <div key={itemKey} className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                          <span className="ml-auto text-zinc-500">+ to use</span>
                        </div>
                      ) : (
                        <div key={`amt-ex-${itemKey}`} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Body: machines with add above/below */}
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-3">
                {sliceNodes.flatMap((node, i) => {
                  const allPrevSlices = slices.slice(0, sliceIdx);
                  const opts = childOptions(node, sliceIdx, allPrevSlices);
                  const parent = node.parentId ? findNode(tree, node.parentId) : null;
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
                  const prevNode = i > 0 ? sliceNodes[i - 1] : null;
                  const canMerge =
                    i > 0 &&
                    prevNode &&
                    parent &&
                    prevNode.parentId === node.parentId &&
                    prevNode.node.outputItemKey &&
                    node.node.outputItemKey &&
                    prevNode.node.outputItemKey === node.node.outputItemKey;
                  return [
                    i > 0 ? (
                      <div
                        key={`add-merge-${node.id}`}
                        className="flex shrink-0 items-center gap-1"
                      >
                        {canMerge && onMergeNodes ? (
                          <button
                            type="button"
                            onClick={() => onMergeNodes(parent!.id, prevNode!.id, node.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-400 transition hover:border-amber-500/40 hover:text-amber-400"
                            title="Combine machines"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setAddMachineParent(parent ?? node);
                            setAddMachineInsertIndex(parent ? parent.children.findIndex((c) => c.id === node.id) : 0);
                            setAddMachineSliceIdx(sliceIdx);
                            setAddMachinePrevSlice(sliceIdx > 0 ? prevSlice : null);
                            setAddMachineAllPrevSlices(slices.slice(0, sliceIdx));
                            setAddMachineOpen(true);
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40"
                        >
                          +
                        </button>
                      </div>
                    ) : null,
                    <div key={node.id} className="flex shrink-0 flex-col items-center gap-2">
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
                                  value={beltKey}
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
                                  {BELTS.map((b) => (
                                    <option key={b.key_name} value={b.key_name}>
                                      {formatRate(b.rate)}/min
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
                        onRemove={parent ? () => removeNode(parent.id, node.id) : undefined}
                        totalDemand={node.children.reduce((s, c) => s + getChildDemandForParentOutput(c, node.node.outputItemKey), 0)}
                        childCount={node.children.length}
                        flowData={flowRates.get(node.id)}
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
                    </div>,
                  ].filter(Boolean);
                })}
                <button
                  type="button"
                  onClick={() => {
                    const firstInSlice = sliceNodes[0];
                    const parent =
                      firstInSlice?.parentId != null
                        ? findNode(tree, firstInSlice.parentId)
                        : null;
                    const targetParent = parent ?? firstInSlice ?? null;
                    const insertIndex = targetParent
                      ? (parent ?? targetParent).children.length
                      : 0;
                    setAddMachineParent(targetParent);
                    setAddMachineInsertIndex(insertIndex);
                    setAddMachineSliceIdx(sliceIdx);
                    setAddMachinePrevSlice(sliceIdx > 0 ? prevSlice : null);
                    setAddMachineAllPrevSlices(slices.slice(0, sliceIdx));
                    setAddMachineOpen(true);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40"
                >
                  +
                </button>
              </div>

              {/* Footer: outputs stacked - fixed height, expand shows overlay */}
              <div className="relative flex shrink-0 flex-col overflow-visible border-t border-zinc-800">
                {outputsByItem.size > 0 && (
                  <>
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
                    <div className="h-[5.5rem] overflow-hidden px-2 py-2">
                      {outputsByItem.size > 2 && outputExpanded.has(sliceIdx) ? (
                        <div className="h-full" aria-hidden />
                      ) : (
                    <div className={`flex h-full flex-col gap-1.5 overflow-hidden ${outputsByItem.size > 2 ? "max-h-full" : ""}`}>
                      {Array.from(outputsByItem.entries()).map(([itemKey, rate]) => (
                        <div key={itemKey} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                          <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                        </div>
                      ))}
                    </div>
                      )}
                    </div>
                    {outputsByItem.size > 2 && outputExpanded.has(sliceIdx) && (
                      <div className="absolute bottom-0 left-0 right-0 z-50 flex min-h-[5.5rem] max-h-[85vh] flex-col gap-1.5 overflow-y-auto border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                        <button
                          type="button"
                          onClick={() => setOutputExpanded((prev) => { const next = new Set(prev); next.delete(sliceIdx); return next; })}
                          className="flex w-full items-center justify-center gap-1 py-0.5 text-xs text-zinc-500 transition hover:text-zinc-300"
                        >
                          <span>OUTPUT</span>
                          <svg className="h-3 w-3 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {Array.from(outputsByItem.entries()).map(([itemKey, rate]) => (
                          <div key={itemKey} className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-xs">
                            <span className="font-medium text-amber-400">{formatRate(rate)} {getItemName(itemKey, "compact")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}

      {/* Add new slice (next column) */}
      <button
        type="button"
        onClick={() => {
          const lastSlice = slices[slices.length - 1];
          const lastNode = lastSlice?.[lastSlice.length - 1];
          setAddMachineParent(lastNode ?? null);
          setAddMachineInsertIndex(lastNode ? lastNode.children.length : 0);
          setAddMachineSliceIdx(slices.length > 0 ? slices.length - 1 : 0);
          setAddMachinePrevSlice(lastSlice ?? null);
          setAddMachineAllPrevSlices(slices.slice(0, slices.length));
          setAddMachineOpen(true);
        }}
        className="ml-4 flex shrink-0 flex-col items-center justify-center gap-1 self-center rounded-xl border-2 border-dashed border-zinc-600 px-6 py-4 text-zinc-400 transition hover:border-amber-500/40"
      >
        <span className="text-2xl">+</span>
        <span className="text-xs">Add slice</span>
      </button>

      {addMachineOpen && addMachineParent && (
        <AddMachineModal
          title="Add machine"
          options={childOptions(addMachineParent, addMachineSliceIdx, addMachineAllPrevSlices ?? [])}
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
                    beltKey: pickDefaultBelt(inp.perMinute),
                  });
                }
              }
            }
            onAddMachine(parent, opt, insertIndex, inputEdges.length > 0 ? inputEdges : undefined);
            setAddMachineOpen(false);
          }}
          onClose={() => setAddMachineOpen(false)}
        />
      )}
    </div>
  );
}

function flowHoverHighlightClass(flowHighlightSelf: boolean, flowHighlightRelated: boolean): string {
  if (flowHighlightSelf) {
    return "ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950 z-[5]";
  }
  if (flowHighlightRelated) {
    return "ring-2 ring-sky-500/70 ring-offset-2 ring-offset-zinc-950 bg-sky-950/25 z-[1]";
  }
  return "";
}

interface FlowNodeCardProps {
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
  compact?: boolean;
  fixedWidth?: boolean;
  flowHighlightSelf?: boolean;
  flowHighlightRelated?: boolean;
  onFlowHoverEnter?: () => void;
  onFlowHoverLeave?: () => void;
  /** Pin upstream branch highlight (toggle) */
  onFlowPinClick?: () => void;
}

function FlowNodeCard({
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

  const perMachineOutput = node.outputPerMachine * (node.clockPercent / 100);
  const allocatedInput = (node.inputPerMachine ?? 0) * node.count;
  const hasFullFlowData = flowData && "beltCapacity" in flowData;
  const isUnderfed =
    flowData &&
    "utilization" in flowData &&
    (flowData as FlowRateData).utilization < 1;

  const nameDensity: ItemDisplayDensity = isCompact ? "compact" : "comfortable";
  const displayProductName = getItemName(node.outputItemKey, nameDensity);
  const recipeNameAbbrev = node.recipeName ? abbreviateItemDisplayName(node.recipeName, nameDensity) : "";
  const showRecipeSubtitle = Boolean(recipeNameAbbrev && recipeNameAbbrev !== displayProductName);

  const shardsPerMachine = powerShardsForClockPercent(node.clockPercent);
  const totalPowerShards = shardsPerMachine * node.count;
  const SHARD_DOT_CAP = 8;
  const shardDotsToRender = Math.min(totalPowerShards, SHARD_DOT_CAP);
  const shardDotsOverflow = totalPowerShards > SHARD_DOT_CAP ? totalPowerShards - SHARD_DOT_CAP : 0;

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
        flex flex-col gap-1 rounded-lg border-2 bg-zinc-900/90 px-3 py-2 shadow transition-all
        hover:border-zinc-600
        ${widthClass}
        ${flowHoverHighlightClass(flowHighlightSelf, flowHighlightRelated)}
        ${isOpen ? "border-amber-500/60" : isUnderfed ? "border-amber-500/50 !bg-amber-900/30" : "border-zinc-800"}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-zinc-100">
          {node.count} {node.buildingName}
        </div>
        {totalPowerShards > 0 && (
          <div
            className="flex max-w-[3.25rem] shrink-0 flex-wrap justify-end gap-0.5 pt-px"
            title={`${totalPowerShards} power shard${totalPowerShards !== 1 ? "s" : ""} (${node.count} machine${node.count !== 1 ? "s" : ""} × ${shardsPerMachine} shard${shardsPerMachine !== 1 ? "s" : ""} each @ ${node.clockPercent}%)`}
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
              } else if (onRemove && window.confirm("Do you want to delete this machine?")) {
                onRemove();
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
            onClick={() => setIsCompact(false)}
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title="Expand"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
        <DraggablePercent
          value={node.clockPercent}
          onChange={(v) => onUpdate({ clockPercent: v })}
          className="shrink-0 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        />
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <>
        {compactView}
        {editModalOpen && (
          <EditNodeModal
            node={node}
            machineOptions={sortedMachine}
            producesOptions={sortedProduces}
            onUpdate={onUpdate}
            onSelectMachine={(opt) => { onSelectMachine(opt); setEditModalOpen(false); }}
            onClose={() => setEditModalOpen(false)}
            onSeparate={onSeparate ? () => { onSeparate(); setEditModalOpen(false); } : undefined}
            onRemove={onRemove ? () => { onRemove(); setEditModalOpen(false); } : undefined}
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
      </>
    );
  }

  return (
    <div
      data-flow-node-card
      onClick={() => {
        onSetSeparateAction?.(onSeparate ?? null);
        onFlowPinClick?.();
      }}
      onMouseEnter={onFlowHoverEnter}
      onMouseLeave={onFlowHoverLeave}
      className={`
        flex flex-col gap-3 rounded-xl border-2 bg-zinc-900/90 p-4 shadow-lg transition-all
        hover:border-zinc-600
        ${widthClass}
        ${flowHoverHighlightClass(flowHighlightSelf, flowHighlightRelated)}
        ${isOpen ? "border-amber-500/60 ring-2 ring-amber-500/20" : isUnderfed ? "border-amber-500/50 !bg-amber-900/30" : "border-zinc-800"}
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
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <DraggablePercent
            value={node.clockPercent}
            onChange={(v) => onUpdate({ clockPercent: v })}
            className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-center text-xs text-zinc-100"
          />
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
              } else if (onRemove && window.confirm("Do you want to delete this machine?")) {
                onRemove();
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
          onSeparate={onSeparate ? () => { onSeparate(); setEditModalOpen(false); } : undefined}
          onRemove={onRemove ? () => { onRemove(); setEditModalOpen(false); } : undefined}
        />
      )}
    </div>
  );
}
