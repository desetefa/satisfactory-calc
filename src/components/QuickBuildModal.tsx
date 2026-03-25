"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyName } from "@/lib/types";
import { getAllProductKeysWithRecipes, getLinearChainItems, getMachineOptionsForProduct, sortOptionsNonAltFirst } from "@/lib/chain";
import { getItemDisplayName } from "@/lib/itemDisplayName";
import { isRecipeSupportedByPlanner } from "@/lib/productionPlanner";

const MINER_OPTIONS = [
  { key: "miner-mk1", label: "Miner Mk.1" },
  { key: "miner-mk2", label: "Miner Mk.2" },
  { key: "miner-mk3", label: "Miner Mk.3" },
] as const;

function productLabel(key: KeyName): string {
  return getItemDisplayName(key, "comfortable");
}

export function QuickBuildModal({
  open,
  onClose,
  onConfirm,
  error,
  hasExistingChart,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (args: { productKey: KeyName; recipeKey: string; minerKey: string }) => void;
  error: string | null;
  hasExistingChart: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<KeyName | null>(null);
  const [recipeSelect, setRecipeSelect] = useState("");
  const [minerKey, setMinerKey] = useState<string>("miner-mk2");
  const searchRef = useRef<HTMLInputElement>(null);

  const recipeOptions = useMemo(() => {
    if (!selectedKey) return [];
    return sortOptionsNonAltFirst(getMachineOptionsForProduct(selectedKey));
  }, [selectedKey]);

  const resolvedRecipeKey =
    recipeOptions.length === 1 ? recipeOptions[0]!.recipeKey : recipeSelect || null;

  const allKeys = useMemo(() => getAllProductKeysWithRecipes(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allKeys.slice(0, 120);
    return allKeys
      .filter((k) => {
        const name = productLabel(k).toLowerCase();
        return name.includes(q) || k.toLowerCase().includes(q);
      })
      .slice(0, 80);
  }, [allKeys, query]);

  const suggestions = useMemo(() => getLinearChainItems(), []);

  useLayoutEffect(() => {
    searchRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const recipeOk = Boolean(resolvedRecipeKey && isRecipeSupportedByPlanner(resolvedRecipeKey));

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/60" aria-hidden onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-[90] flex max-h-[min(90vh,640px)] w-[min(96vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/50"
        role="dialog"
        aria-labelledby="quick-build-title"
        aria-modal="true"
      >
        <div className="shrink-0 border-b border-zinc-800 px-4 py-3">
          <h2 id="quick-build-title" className="text-base font-semibold text-zinc-100">
            Quick build line
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Choose an <span className="text-zinc-400">end product</span> and <span className="text-zinc-400">recipe</span>.
            The planner lays out a <span className="text-zinc-400">full production line</span> (that machine at 100% plus every
            upstream step to raw resources), then <span className="text-zinc-400">auto-balances</span> belts and machine
            counts so inputs match.
          </p>
          {hasExistingChart && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200/90">
              This replaces the current factory on the canvas. Save the chart first if you need it.
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Search product
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. encased industrial beam, iron plate…"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
            />
          </label>

          {query.trim().length === 0 && suggestions.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Common starters
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 12).map(({ key, name }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedKey(key);
                      setRecipeSelect("");
                    }}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      selectedKey === key
                        ? "border-amber-500/60 bg-amber-950/50 text-amber-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
            <ul className="max-h-[160px] overflow-y-auto py-1" role="listbox">
              {filtered.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedKey === k}
                    onClick={() => {
                      setSelectedKey(k);
                      setRecipeSelect("");
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                      selectedKey === k ? "bg-amber-900/35 text-amber-100" : "text-zinc-300 hover:bg-zinc-800/80"
                    }`}
                  >
                    <span className="truncate">{productLabel(k)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selectedKey && recipeOptions.length === 0 && (
            <p className="text-xs text-amber-400/90">No recipes found for this item.</p>
          )}

          {selectedKey && recipeOptions.length > 1 && (
            <label className="block text-xs font-medium text-zinc-500">
              Recipe / building
              <select
                value={recipeSelect}
                onChange={(e) => setRecipeSelect(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
              >
                <option value="">Select recipe…</option>
                {recipeOptions.map((opt) => (
                  <option key={opt.recipeKey} value={opt.recipeKey}>
                    {opt.buildingName} — {opt.recipeName}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selectedKey && recipeOptions.length === 1 && (
            <p className="text-xs text-zinc-500">
              Recipe: <span className="text-zinc-300">{recipeOptions[0]!.recipeName}</span> (
              {recipeOptions[0]!.buildingName})
            </p>
          )}

          <label className="block text-xs font-medium text-zinc-500">
            Ore miner (mineral extractors)
            <select
              value={minerKey}
              onChange={(e) => setMinerKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
            >
              {MINER_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedKey || !resolvedRecipeKey || !recipeOk}
            onClick={() => {
              if (!selectedKey || !resolvedRecipeKey) return;
              onConfirm({ productKey: selectedKey, recipeKey: resolvedRecipeKey, minerKey });
            }}
            className="rounded-lg border border-amber-500/50 bg-amber-950/60 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Build &amp; balance
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

const QUICK_BUILD_TITLE =
  "Pick a product and recipe: builds the full line (one machine at 100% for that step, all upstream scaled), then auto-balances belts and counts.";

/** Dashed control for the flow canvas (same family as “Add slice” / “Add machine”). */
export function QuickBuildLineButton({
  onClick,
  className = "",
  size = "default",
}: {
  onClick: () => void;
  className?: string;
  /** `compact` = smaller, for tight rows */
  size?: "default" | "compact";
}) {
  const isCompact = size === "compact";
  return (
    <button
      type="button"
      onClick={onClick}
      title={QUICK_BUILD_TITLE}
      aria-label="Quick build line: full production chain from a product"
      className={`flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-600 text-zinc-400 transition hover:border-amber-500/40 hover:bg-zinc-800/80 ${
        isCompact ? "min-h-[100px] min-w-[112px] px-3 py-3" : "min-h-[120px] min-w-[140px] px-4 py-4"
      } ${className}`}
    >
      <span className={`font-light text-amber-400/90 ${isCompact ? "text-2xl" : "text-3xl"}`}>+</span>
      <span className={`text-center font-medium text-zinc-300 ${isCompact ? "text-[11px] leading-tight" : "text-xs"}`}>
        Quick build line
      </span>
      <span
        className={`max-w-[9.5rem] text-center leading-snug text-zinc-500 ${isCompact ? "text-[9px]" : "text-[10px]"}`}
      >
        Product → full chain, auto-balanced
      </span>
    </button>
  );
}
