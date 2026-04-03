"use client";

import { useState } from "react";
import type { WorkspaceDoc } from "@/lib/chartStorage";
import { getItemName } from "@/components/flow-chart/flowChartDisplay";
import { formatRate } from "@/components/flow-chart/flowChartDisplay";

interface Props {
  workspace: WorkspaceDoc;
  activeFactoryId: string;
  onAddExport: (toFactoryId: string, itemKey: string, ratePerMin: number) => void;
  onRemoveConnection: (exportId: string) => void;
}

export function FactoryConnectionsPanel({
  workspace,
  activeFactoryId,
  onAddExport,
  onRemoveConnection,
}: Props) {
  const [addingExport, setAddingExport] = useState(false);
  const [exportTarget, setExportTarget] = useState("");
  const [exportItem, setExportItem] = useState("");
  const [exportRate, setExportRate] = useState("");

  const activeFactory = workspace.factories.find((f) => f.id === activeFactoryId);
  if (!activeFactory) return null;

  const otherFactories = workspace.factories.filter((f) => f.id !== activeFactoryId);

  const handleAdd = () => {
    const rate = parseFloat(exportRate);
    if (!exportTarget || !exportItem || isNaN(rate) || rate <= 0) return;
    onAddExport(exportTarget, exportItem, rate);
    setAddingExport(false);
    setExportTarget("");
    setExportItem("");
    setExportRate("");
  };

  // Resolve display names for connections
  const getFactoryName = (id: string) =>
    workspace.factories.find((f) => f.id === id)?.name ?? "Unknown";

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-4">
        {/* Imports section */}
        <div className="flex-1">
          <p className="mb-1.5 font-medium uppercase tracking-wide text-zinc-400">
            Receiving from
          </p>
          {activeFactory.imports.length === 0 ? (
            <p className="text-zinc-600 italic">No imports</p>
          ) : (
            <ul className="space-y-1">
              {activeFactory.imports.map((imp) => (
                <li key={imp.id} className="flex items-center gap-2">
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">
                    {getFactoryName(imp.fromFactoryId)}
                  </span>
                  <span className="text-zinc-500">→</span>
                  <span className="text-amber-300">
                    {getItemName(imp.itemKey as Parameters<typeof getItemName>[0])}
                  </span>
                  <span className="text-zinc-500">{formatRate(imp.ratePerMin)}/min</span>
                  <button
                    type="button"
                    onClick={() => onRemoveConnection(imp.id)}
                    className="ml-auto flex h-4 w-4 items-center justify-center rounded text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                    title="Remove connection"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Divider */}
        <div className="h-10 w-px bg-zinc-800" />

        {/* Exports section */}
        <div className="flex-1">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="font-medium uppercase tracking-wide text-zinc-400">Sending to</p>
            {otherFactories.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAddingExport(true);
                  setExportTarget(otherFactories[0]?.id ?? "");
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                </svg>
                Add
              </button>
            )}
          </div>
          {activeFactory.exports.length === 0 && !addingExport ? (
            <p className="text-zinc-600 italic">No exports</p>
          ) : (
            <ul className="space-y-1">
              {activeFactory.exports.map((exp) => (
                <li key={exp.id} className="flex items-center gap-2">
                  <span className="text-amber-300">
                    {getItemName(exp.itemKey as Parameters<typeof getItemName>[0])}
                  </span>
                  <span className="text-zinc-500">→</span>
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">
                    {getFactoryName(exp.toFactoryId)}
                  </span>
                  <span className="text-zinc-500">{formatRate(exp.ratePerMin)}/min</span>
                  <button
                    type="button"
                    onClick={() => onRemoveConnection(exp.id)}
                    className="ml-auto flex h-4 w-4 items-center justify-center rounded text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                    title="Remove connection"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add export form */}
          {addingExport && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 p-2">
              <select
                value={exportTarget}
                onChange={(e) => setExportTarget(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
              >
                {otherFactories.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Item key (e.g. ironPlate)"
                value={exportItem}
                onChange={(e) => setExportItem(e.target.value)}
                className="w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
              <input
                type="number"
                placeholder="Rate/min"
                value={exportRate}
                onChange={(e) => setExportRate(e.target.value)}
                min={0.01}
                step={0.01}
                className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={handleAdd}
                className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 transition"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAddingExport(false)}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
