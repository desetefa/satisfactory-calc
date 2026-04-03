"use client";

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { FactoryRecord, WorkspaceDoc, FactoryExport } from "@/lib/chartStorage";
import { getItemName, formatRate } from "@/components/flow-chart/flowChartDisplay";
import { getAllNodes, computeFlowRates, computeFlowBalanceMaps } from "@/lib/flowChartFlowRates";
import type { KeyName } from "@/lib/types";

interface Props {
  factory: FactoryRecord;
  workspace: WorkspaceDoc;
  onRename: (newName: string) => void;
  onAddExport: (toFactoryId: string, itemKey: string, ratePerMin: number) => void;
  onAddImport: (fromFactoryId: string, itemKey: string, ratePerMin: number) => void;
  onRemoveConnection: (exportId: string) => void;
  onClose: () => void;
}

/** Net excess produced by the factory tree (produced − internally consumed), keyed by item → rate/min */
function getFactoryOutputs(factory: FactoryRecord): Map<KeyName, number> {
  const tree = factory.tree;
  if (!tree.node.outputItemKey) return new Map();
  const flowRates = computeFlowRates(tree);
  const { produced, consumed } = computeFlowBalanceMaps(tree, flowRates);
  const excess = new Map<KeyName, number>();
  for (const [key, rate] of produced) {
    const net = rate - (consumed.get(key) ?? 0);
    if (net > 0.001) excess.set(key, net);
  }
  return excess;
}

/** Row for a single produced item in the exports section */
function ProductExportRow({
  itemKey,
  producedRate,
  existingExports,
  otherFactories,
  onAdd,
  onRemove,
}: {
  itemKey: KeyName;
  producedRate: number;
  existingExports: FactoryExport[];
  otherFactories: { id: string; name: string }[];
  onAdd: (toFactoryId: string, rate: number) => void;
  onRemove: (exportId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState(otherFactories[0]?.id ?? "");
  const [rate, setRate] = useState("");

  const totalExported = existingExports.reduce((s, e) => s + e.ratePerMin, 0);
  const surplus = Math.max(0, producedRate - totalExported);

  const handleAdd = () => {
    const r = parseFloat(rate);
    if (!target || isNaN(r) || r <= 0) return;
    onAdd(target, r);
    setAdding(false);
    setRate("");
    setTarget(otherFactories[0]?.id ?? "");
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
      {/* Item header */}
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-zinc-100">{getItemName(itemKey)}</span>
        <span className="text-xs text-zinc-500">{formatRate(producedRate)}/min excess</span>
        {totalExported > 0.001 && surplus > 0.01 && (
          <span className="ml-auto text-xs text-emerald-500">{formatRate(surplus)}/min unrouted</span>
        )}
        {totalExported > 0.001 && surplus <= 0.01 && (
          <span className="ml-auto text-xs text-amber-500/70">fully routed</span>
        )}
      </div>

      {/* Existing export rows */}
      {existingExports.length > 0 && (
        <ul className="mt-2 space-y-1">
          {existingExports.map((exp) => {
            const destName = otherFactories.find((f) => f.id === exp.toFactoryId)?.name ?? "Unknown";
            return (
              <li key={exp.id} className="flex items-center gap-2 pl-2">
                <svg className="h-3 w-3 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">{destName}</span>
                <span className="text-xs text-zinc-400">{formatRate(exp.ratePerMin)}/min</span>
                <button
                  type="button"
                  onClick={() => onRemove(exp.id)}
                  className="ml-auto flex h-4 w-4 items-center justify-center rounded text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 transition"
                  title="Remove"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add route */}
      {!adding ? (
        otherFactories.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setRate(surplus > 0.01 ? String(Math.round(surplus * 100) / 100) : "");
            }}
            className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
            </svg>
            Route to factory…
          </button>
        )
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500/60 outline-none"
          >
            {otherFactories.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <input
            autoFocus
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="/min"
            min={0.01}
            step={0.01}
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!target || !rate}
            className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 transition"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs text-zinc-600 hover:text-zinc-300 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function FactoryEditModal({
  factory,
  workspace,
  onRename,
  onAddExport,
  onAddImport,
  onRemoveConnection,
  onClose,
}: Props) {
  const [name, setName] = useState(factory.name);

  const otherFactories = useMemo(
    () => workspace.factories.filter((f) => f.id !== factory.id),
    [workspace.factories, factory.id]
  );

  const getFactoryName = (id: string) =>
    workspace.factories.find((f) => f.id === id)?.name ?? "Unknown";

  // Items produced by this factory
  const outputs = useMemo(() => getFactoryOutputs(factory), [factory]);

  // Group existing exports by item key for quick lookup
  const exportsByItem = useMemo(() => {
    const map = new Map<KeyName, FactoryExport[]>();
    for (const exp of factory.exports) {
      const key = exp.itemKey as KeyName;
      const list = map.get(key) ?? [];
      list.push(exp);
      map.set(key, list);
    }
    return map;
  }, [factory.exports]);

  const availableImports = useMemo(() => {
    const rows: {
      fromFactoryId: string;
      fromFactoryName: string;
      itemKey: KeyName;
      availableRate: number;
      alreadyImportedRate: number;
    }[] = [];

    for (const src of otherFactories) {
      const srcOutputs = getFactoryOutputs(src);
      for (const [itemKey, availableRate] of srcOutputs) {
        const alreadyImportedRate = factory.imports
          .filter((imp) => imp.fromFactoryId === src.id && imp.itemKey === itemKey)
          .reduce((sum, imp) => sum + imp.ratePerMin, 0);
        rows.push({
          fromFactoryId: src.id,
          fromFactoryName: src.name,
          itemKey,
          availableRate,
          alreadyImportedRate,
        });
      }
    }

    rows.sort((a, b) => {
      const byFactory = a.fromFactoryName.localeCompare(b.fromFactoryName);
      if (byFactory !== 0) return byFactory;
      return getItemName(a.itemKey).localeCompare(getItemName(b.itemKey));
    });

    return rows;
  }, [otherFactories, factory.imports]);

  const handleNameBlur = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== factory.name) onRename(trimmed);
  };

  const noOutputs = outputs.size === 0;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-zinc-700 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-100">Edit Factory</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-6">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/60"
            />
          </div>

          {/* Imports */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Receiving from other factories
            </p>
            {factory.imports.length === 0 ? (
              <p className="text-sm text-zinc-600 italic">Nothing imported yet</p>
            ) : (
              <ul className="space-y-1.5">
                {factory.imports.map((imp) => (
                  <li
                    key={imp.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-sm"
                  >
                    <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                      {getFactoryName(imp.fromFactoryId)}
                    </span>
                    <svg className="h-3.5 w-3.5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m0 0l-6-6m6 6l6-6" />
                    </svg>
                    <span className="font-medium text-amber-300">
                      {getItemName(imp.itemKey as KeyName)}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {formatRate(imp.ratePerMin)}/min
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveConnection(imp.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 transition"
                      title="Remove"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Available from other factories
              </p>
              {availableImports.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">No available outputs from other factories yet</p>
              ) : (
                <ul className="space-y-1.5">
                  {availableImports.map((row) => {
                    const remaining = Math.max(0, row.availableRate - row.alreadyImportedRate);
                    return (
                      <li
                        key={`${row.fromFactoryId}-${row.itemKey}`}
                        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2 text-xs"
                      >
                        <span className="rounded bg-zinc-700 px-2 py-0.5 text-zinc-300">{row.fromFactoryName}</span>
                        <span className="text-zinc-500">↓</span>
                        <span className="font-medium text-amber-300">{getItemName(row.itemKey)}</span>
                        <span className="ml-auto text-zinc-500">
                          {formatRate(remaining)}/{formatRate(row.availableRate)} /min
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onAddImport(
                              row.fromFactoryId,
                              row.itemKey,
                              Math.round(Math.max(0, remaining) * 100) / 100
                            )
                          }
                          disabled={remaining <= 0.01}
                          className="rounded-lg bg-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 transition"
                        >
                          Receive
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Exports — driven by what the factory actually produces */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Send products to other factories
            </p>

            {noOutputs ? (
              <p className="text-sm text-zinc-600 italic">
                Add machines to this factory to see its products here.
              </p>
            ) : otherFactories.length === 0 ? (
              <p className="text-sm text-zinc-600 italic">
                Add another factory to route products to it.
              </p>
            ) : (
              <div className="space-y-2">
                {[...outputs.entries()]
                  .sort(([a], [b]) => getItemName(a).localeCompare(getItemName(b)))
                  .map(([itemKey, producedRate]) => (
                    <ProductExportRow
                      key={itemKey}
                      itemKey={itemKey}
                      producedRate={producedRate}
                      existingExports={exportsByItem.get(itemKey) ?? []}
                      otherFactories={otherFactories}
                      onAdd={(toFactoryId, rate) => onAddExport(toFactoryId, itemKey, rate)}
                      onRemove={onRemoveConnection}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-zinc-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
