"use client";

import { useState } from "react";
import type { SaveAsModalProps } from "@/components/flow-chart/flowChartTypes";

export function SaveAsModal({ currentName, onSave, onClose }: SaveAsModalProps) {
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
