"use client";

import { useMemo, useState } from "react";
import {
  getAllProductKeysWithRecipes,
  getMachineOptionsForProduct,
  sortOptionsNonAltFirst,
} from "@/lib/chain";
import { getMiner } from "@/lib/db";
import type { KeyName } from "@/lib/types";
import { getInputSlots, getItemName } from "@/components/flow-chart/flowChartDisplay";
import type { AddMachineModalProps, MachineOption } from "@/components/flow-chart/flowChartTypes";

type Building = {
  buildingKey: string;
  buildingName: string;
  firstOption: MachineOption;
  buildingKeys?: string[];
};

function optionKey(opt: MachineOption): string {
  return `${opt.recipeKey}|${opt.buildingKey}|${opt.outputItemKey}`;
}

function dedupeOptions(opts: MachineOption[]): MachineOption[] {
  const seen = new Set<string>();
  const out: MachineOption[] = [];
  for (const opt of opts) {
    const key = optionKey(opt);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(opt);
  }
  return out;
}

function getUniqueBuildings(options: MachineOption[]): Building[] {
  const seen = new Set<string>();
  const result: Building[] = [];
  for (const opt of options) {
    if (!seen.has(opt.buildingKey)) {
      seen.add(opt.buildingKey);
      result.push({ buildingKey: opt.buildingKey, buildingName: opt.buildingName, firstOption: opt });
    }
  }
  return result;
}

function collapseMinerBuildings(buildings: Building[]): Building[] {
  const minerVariants = buildings.filter((b) => b.buildingKey.startsWith("miner-mk"));
  const others = buildings.filter((b) => !b.buildingKey.startsWith("miner-mk"));
  if (minerVariants.length <= 1) return buildings;

  const preferred = minerVariants.find((b) => b.buildingKey === "miner-mk2") ?? minerVariants[0]!;
  const mergedMiner: Building = {
    buildingKey: "miner-group",
    buildingName: "Miner",
    firstOption: preferred.firstOption,
    buildingKeys: minerVariants.map((b) => b.buildingKey),
  };
  return [mergedMiner, ...others];
}

type AddMachineModalTab = "machine" | "product";

const isAlt = (opt: { recipeName: string }) => opt.recipeName.startsWith("Alternate");

export function AddMachineModal({ title, options, allOptions, onSelect, onClose }: AddMachineModalProps) {
  const [tab, setTab] = useState<AddMachineModalTab>("machine");
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedMinerMk, setSelectedMinerMk] = useState<string>("miner-mk2");
  const [minerDropdownOpen, setMinerDropdownOpen] = useState(false);
  const [productPickKey, setProductPickKey] = useState<KeyName | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [showAlternates, setShowAlternates] = useState(false);

  const filterAlts = <T extends { recipeName: string }>(arr: T[]): T[] =>
    showAlternates ? arr : arr.filter((o) => !isAlt(o));

  // Whether we have a meaningful recommended/other split
  const sortedRecommended = sortOptionsNonAltFirst(dedupeOptions(filterAlts(options)));
  const hasRecommended = !!allOptions && allOptions.length > options.length;

  // Full pool (recommended + everything else), deduped by recipeKey
  const sortedAll = useMemo(() => {
    const filtered = dedupeOptions(filterAlts(allOptions ?? options));
    const base = sortOptionsNonAltFirst(dedupeOptions(filterAlts(options)));
    if (!allOptions) return base;
    const seen = new Set(base.map((o) => optionKey(o)));
    const extra = sortOptionsNonAltFirst(filtered).filter((o) => !seen.has(optionKey(o)));
    return [...base, ...extra];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOptions, options, showAlternates]);

  // Buildings for each section
  const recBuildingKeys = useMemo(
    () => new Set(sortedRecommended.map((o) => o.buildingKey)),
    [sortedRecommended]
  );
  const recBuildings = getUniqueBuildings(sortedRecommended);
  const otherBuildings = useMemo(
    () => getUniqueBuildings(sortedAll).filter((b) => !recBuildingKeys.has(b.buildingKey)),
    [sortedAll, recBuildingKeys]
  );

  const slotCount = (b: Building) => getInputSlots(b.buildingKeys?.[0] ?? b.buildingKey);
  const recExtractors = collapseMinerBuildings(recBuildings.filter((b) => getMiner(b.buildingKey)))
    .sort((a, b) => slotCount(a) - slotCount(b));
  const recProducers = recBuildings
    .filter((b) => !getMiner(b.buildingKey))
    .sort((a, b) => getInputSlots(a.buildingKey) - getInputSlots(b.buildingKey));
  const otherExtractors = collapseMinerBuildings(otherBuildings.filter((b) => getMiner(b.buildingKey)))
    .sort((a, b) => slotCount(a) - slotCount(b));
  const otherProducers = otherBuildings
    .filter((b) => !getMiner(b.buildingKey))
    .sort((a, b) => getInputSlots(a.buildingKey) - getInputSlots(b.buildingKey));

  // Recipes shown when a building is selected:
  // recommended recipes come first, then others (same building from allOptions)
  const buildingRecipes = selectedBuilding
    ? sortedAll.filter((o) =>
        (selectedBuilding.buildingKeys ?? [selectedBuilding.buildingKey]).includes(o.buildingKey)
      )
    : [];
  const recRecipeKeys = useMemo(
    () => new Set(sortedRecommended.map((o) => o.recipeKey)),
    [sortedRecommended]
  );

  // Product tab
  const allProductKeys = useMemo(() => getAllProductKeysWithRecipes(), []);
  const productRecipes = useMemo(
    () => dedupeOptions(filterAlts(productPickKey ? getMachineOptionsForProduct(productPickKey) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productPickKey, showAlternates]
  );
  // Keys that are reachable from current inputs
  const recProductKeys = useMemo(
    () => new Set<KeyName>(sortedRecommended.map((o) => o.outputItemKey as KeyName)),
    [sortedRecommended]
  );

  const filteredProductKeys = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const keys = q
      ? allProductKeys.filter((key) => {
          const label = getItemName(key).toLowerCase();
          return label.includes(q) || key.toLowerCase().includes(q);
        })
      : allProductKeys;
    if (!hasRecommended || q) return keys; // no split when searching
    return keys; // split handled in render
  }, [allProductKeys, productQuery, hasRecommended]);

  const switchTab = (next: AddMachineModalTab) => {
    setTab(next);
    setSelectedBuilding(null);
    setMinerDropdownOpen(false);
    setProductPickKey(null);
    setProductQuery("");
  };

  const showBack =
    (tab === "machine" && selectedBuilding !== null) || (tab === "product" && productPickKey !== null);

  const handleBack = () => {
    if (tab === "machine") {
      setSelectedBuilding(null);
      setMinerDropdownOpen(false);
    }
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

  const selectMinerBuilding = (b: Building, minerKey: string) => {
    const chosenMinerKey = (b.buildingKeys ?? []).includes(minerKey)
      ? minerKey
      : (b.buildingKeys?.[0] ?? minerKey);
    const chosenOption =
      sortedAll.find((o) => o.buildingKey === chosenMinerKey) ?? b.firstOption;
    setSelectedMinerMk(chosenMinerKey);
    setSelectedBuilding({
      ...b,
      buildingKey: chosenMinerKey,
      buildingName: getMiner(chosenMinerKey)?.name ?? b.buildingName,
      firstOption: chosenOption,
      buildingKeys: [chosenMinerKey],
    });
    setMinerDropdownOpen(false);
  };

  const minerTierLabel = (mkKey: string): string => {
    const m = mkKey.match(/miner-mk(\d+)/i);
    return m ? `MK${m[1]}` : (getMiner(mkKey)?.name ?? mkKey);
  };

  const buildingCard = (b: Building, highlighted: boolean, onClick: () => void) => (
    b.buildingKey === "miner-group" && b.buildingKeys && b.buildingKeys.length > 0 ? (
      <div
        key={b.buildingKey}
        className={`relative w-full rounded-xl border-2 ${
          highlighted
            ? "border-amber-500/40 bg-zinc-800/60"
            : "border-zinc-700 bg-zinc-800/80"
        }`}
      >
        <button
          type="button"
          onClick={() => setMinerDropdownOpen((v) => !v)}
          className="w-full px-3 py-2.5 text-left transition hover:bg-zinc-800"
          aria-haspopup="listbox"
          aria-expanded={minerDropdownOpen}
          aria-label="Select miner tier"
        >
          <div className="flex items-center justify-between">
            <div className="font-medium text-zinc-100">Miner</div>
            <svg
              className={`h-3 w-3 text-zinc-500 transition-transform ${minerDropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 10l5 5 5-5" />
            </svg>
          </div>
        </button>
        {minerDropdownOpen && (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
          >
            {b.buildingKeys.map((mkKey) => (
              <button
                key={mkKey}
                type="button"
                role="option"
                aria-selected={selectedMinerMk === mkKey}
                onClick={() => selectMinerBuilding(b, mkKey)}
                className={`block w-full px-3 py-2 text-left text-xs transition ${
                  selectedMinerMk === mkKey
                    ? "bg-zinc-800 text-amber-300"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {minerTierLabel(mkKey)}
              </button>
            ))}
          </div>
        )}
      </div>
    ) : (
      <button
        key={b.buildingKey}
        type="button"
        onClick={onClick}
        className={`w-full rounded-xl border-2 px-3 py-2.5 text-left transition hover:bg-zinc-800 ${
          highlighted
            ? "border-amber-500/40 bg-zinc-800/60 hover:border-amber-500/70"
            : "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600"
        }`}
      >
        <div className="font-medium text-zinc-100">{b.buildingName}</div>
        {getInputSlots(b.buildingKey) > 0 && (
        <div className="mt-1 flex items-center gap-1" aria-label={`${getInputSlots(b.buildingKey)} inputs`}>
          {Array.from({ length: getInputSlots(b.buildingKey) }).map((_, idx) => (
            <span key={`${b.buildingKey}-input-dot-${idx}`} className="h-1.5 w-1.5 rounded-full bg-zinc-500/80" />
          ))}
          <span className="sr-only">
            {getInputSlots(b.buildingKey)} input{getInputSlots(b.buildingKey) !== 1 ? "s" : ""}
          </span>
        </div>
        )}
      </button>
    )
  );

  const renderSection = (label: string, buildings: Building[], highlighted: boolean) => {
    if (buildings.length === 0) return null;
    return (
      <div className="mb-6 last:mb-0">
        <h3 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${highlighted ? "text-amber-500/70" : "text-zinc-500"}`}>
          {label}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {buildings.map((b) =>
            buildingCard(b, highlighted, () => {
              if (b.buildingKey === "miner-group" && b.buildingKeys && b.buildingKeys.length > 0) {
                selectMinerBuilding(b, selectedMinerMk);
                return;
              }
              setSelectedBuilding(b);
            })
          )}
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
        {/* Header */}
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

        {/* Tabs + alternates toggle */}
        <div className="border-b border-zinc-800 px-6 pt-3 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-1 rounded-lg bg-zinc-800/60 p-1">
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
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-zinc-500 select-none hover:text-zinc-300 transition">
              <input
                type="checkbox"
                checked={showAlternates}
                onChange={(e) => setShowAlternates(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-600 accent-amber-500"
              />
              Alternate recipes
            </label>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[calc(85vh-11rem)] overflow-y-auto p-6">
          {tab === "machine" ? (
            selectedBuilding ? (
              /* Recipe picker for a chosen building */
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  What should this {selectedBuilding.buildingName} produce?
                </p>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {buildingRecipes.map((opt) => {
                    const isRec = recRecipeKeys.has(opt.recipeKey);
                    return (
                      <button
                        key={optionKey(opt)}
                        type="button"
                        onClick={() => onSelect(opt)}
                        className={`w-full rounded-xl border-2 px-3 py-2.5 text-left transition hover:bg-zinc-800 ${
                          isRec && hasRecommended
                            ? "border-amber-500/40 bg-zinc-800/60 hover:border-amber-500/70"
                            : "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600"
                        }`}
                      >
                        <div className="font-medium text-zinc-100">{opt.recipeName}</div>
                        {isRec && hasRecommended && (
                          <div className="mt-1.5 text-xs font-medium text-amber-500/70">
                            uses available inputs
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : hasRecommended ? (
              /* Recommended + Other building sections */
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  Choose a machine type, then select what it produces.
                </p>
                {renderSection("Recommended", [...recExtractors, ...recProducers], true)}
                {(otherExtractors.length > 0 || otherProducers.length > 0) && (
                  <>
                    {(recExtractors.length > 0 || recProducers.length > 0) && (
                      <div className="my-4 border-t border-zinc-800" />
                    )}
                    {renderSection("Extractors", otherExtractors, false)}
                    {renderSection("Producers", otherProducers, false)}
                  </>
                )}
              </>
            ) : (
              /* No split — show everything flat */
              <>
                <p className="mb-4 text-sm text-zinc-500">
                  Choose a machine type, then select what it produces.
                </p>
                {renderSection("Extractors", recExtractors, false)}
                {renderSection("Producers", recProducers, false)}
              </>
            )
          ) : productPickKey ? (
            /* Recipe picker for a chosen product */
            <>
              <p className="mb-4 text-sm text-zinc-500">
                Pick a recipe (standard recipes first). The correct building is selected automatically.
              </p>
              {productRecipes.length === 0 ? (
                <p className="text-sm text-zinc-500">No recipes found for this product.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {productRecipes.map((opt) => {
                    const isRec = recRecipeKeys.has(opt.recipeKey);
                    return (
                      <button
                        key={optionKey(opt)}
                        type="button"
                        onClick={() => onSelect(opt)}
                        className={`w-full rounded-xl border-2 px-3 py-2.5 text-left transition hover:bg-zinc-800 ${
                          isRec && hasRecommended
                            ? "border-amber-500/40 bg-zinc-800/60 hover:border-amber-500/70"
                            : "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600"
                        }`}
                      >
                        <div className="font-medium text-zinc-100">{opt.recipeName}</div>
                        <div className="mt-1 text-xs text-zinc-500">{opt.buildingName}</div>
                        {isRec && hasRecommended && (
                          <div className="mt-1.5 text-xs font-medium text-amber-500/70">
                            uses available inputs
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* Product list */
            <>
              <p className="mb-3 text-sm text-zinc-500">
                {hasRecommended
                  ? "Recommended products use current inputs. Search to see all."
                  : "Search or pick an output item, then choose how to produce it."}
              </p>
              <input
                type="search"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Filter products…"
                autoFocus={tab === "product"}
                className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
              />
              <div className="max-h-[min(50vh,28rem)] overflow-y-auto rounded-lg border border-zinc-800">
                {filteredProductKeys.length === 0 ? (
                  <p className="p-4 text-sm text-zinc-500">No matching products.</p>
                ) : (() => {
                    const isSearching = productQuery.trim() !== "";
                    const recKeys = filteredProductKeys.filter((k) => recProductKeys.has(k));
                    const otherKeys = filteredProductKeys.filter((k) => !recProductKeys.has(k));
                    const showSplit = hasRecommended && !isSearching && recKeys.length > 0;

                    const productRow = (key: KeyName, highlighted: boolean) => (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setProductPickKey(key)}
                          className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition ${
                            highlighted
                              ? "text-zinc-100 hover:bg-zinc-800/60"
                              : "text-zinc-400 hover:bg-zinc-800/40"
                          }`}
                        >
                          <span className="font-medium">{getItemName(key)}</span>
                          {highlighted && hasRecommended ? (
                            <span className="shrink-0 text-xs text-amber-500/60">possible →</span>
                          ) : (
                            <span className="text-zinc-600">→</span>
                          )}
                        </button>
                      </li>
                    );

                    return (
                      <ul className="divide-y divide-zinc-800">
                        {showSplit ? (
                          <>
                            {recKeys.map((k) => productRow(k, true))}
                            {otherKeys.length > 0 && (
                              <>
                                <li className="bg-zinc-900/80 px-4 py-1.5">
                                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                                    Other products
                                  </span>
                                </li>
                                {otherKeys.map((k) => productRow(k, false))}
                              </>
                            )}
                          </>
                        ) : (
                          filteredProductKeys.map((k) => productRow(k, recProductKeys.has(k)))
                        )}
                      </ul>
                    );
                  })()
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
