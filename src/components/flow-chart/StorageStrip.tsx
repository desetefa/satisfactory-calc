"use client";

import type { KeyName } from "@/lib/types";
import { formatRate } from "@/components/flow-chart/flowChartDisplay";

export type StorageStripRow = {
  itemKey: KeyName;
  itemName: string;
  surplusRate: number;
  reservePerMin: number;
};

/** Full-height edge control: same bar for expand (chevron ←) and collapse (chevron →). */
function StoragePanelEdgeBar({
  mode,
  onClick,
  ariaLabel,
  title: titleAttr,
}: {
  mode: "expand" | "collapse";
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  const edge = "border-r border-zinc-800 shadow-[inset_-1px_0_0_0_rgba(39,39,42,0.6)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full min-h-0 w-10 shrink-0 flex-col items-center justify-center gap-1 bg-[#101010] py-6 text-zinc-500 transition hover:bg-zinc-900/90 hover:text-zinc-300 ${edge}`}
      aria-label={ariaLabel}
      title={titleAttr}
    >
      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        {mode === "expand" ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        )}
      </svg>
      <span
        className="select-none text-[9px] font-semibold uppercase tracking-widest text-zinc-600"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Storage
      </span>
    </button>
  );
}

export function StorageStrip({
  rows,
  onReserveDelta,
  onOptimizeRow,
  panelExpanded,
  onExpandPanel,
  onDismiss,
}: {
  rows: StorageStripRow[];
  onReserveDelta: (itemKey: KeyName, delta: number) => void;
  onOptimizeRow: (itemKey: KeyName) => void;
  panelExpanded: boolean;
  onExpandPanel: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside
      className="flex h-full min-h-0 w-64 min-w-64 shrink-0 flex-row border-l border-zinc-800 bg-[#101010] backdrop-blur-md"
      aria-label="Storage"
    >
      <StoragePanelEdgeBar
        mode={panelExpanded ? "collapse" : "expand"}
        onClick={panelExpanded ? onDismiss : onExpandPanel}
        ariaLabel={panelExpanded ? "Hide storage panel" : "Show storage panel"}
        title={panelExpanded ? "Hide storage panel" : "Show storage panel"}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={panelExpanded ? undefined : true}>
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
      </div>
    </aside>
  );
}
