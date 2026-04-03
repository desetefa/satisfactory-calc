"use client";

import { formatRate } from "@/components/flow-chart/flowChartDisplay";
import type { KeyName } from "@/lib/types";
import { getTransportOptionsForItem } from "@/lib/flowTransport";

export function InputFlowBadge({
  value,
  onChange,
  beltCapacity,
  receivesInput,
  itemKey,
  itemName,
  compact = false,
  fullWidth = false,
  readOnly = false,
}: {
  value: string;
  onChange: (key: string) => void;
  beltCapacity: number;
  receivesInput: number;
  itemKey: KeyName;
  itemName: string;
  compact?: boolean;
  fullWidth?: boolean;
  readOnly?: boolean;
}) {
  const isBottleneck = receivesInput >= beltCapacity && beltCapacity > 0;
  const transportOptions = getTransportOptionsForItem(itemKey);
  if (compact) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
          fullWidth ? "w-full min-w-full" : ""
        } ${
          isBottleneck ? "bg-amber-500/20 text-amber-300" : "bg-zinc-800/90 text-zinc-300"
        }`}
      >
        <span>
          {formatRate(receivesInput)}
          {itemName ? ` ${itemName}` : ""}
        </span>
        {!readOnly && (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer border-none bg-transparent py-0 text-inherit focus:outline-none focus:ring-0"
            title="Change transport"
          >
            {transportOptions.map((t) => (
              <option key={t.key_name} value={t.key_name}>
                {formatRate(t.rate)}/min
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
          title="Change transport"
        >
          {transportOptions.map((t) => (
            <option key={t.key_name} value={t.key_name}>
              {formatRate(t.rate)}/min
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
