/**
 * localStorage persistence for flow charts
 */

import type { TreeNode } from "@/lib/flowChartModel";

const STORAGE_KEY = "satisfactory-calc-charts";
const LAST_CHART_KEY = "satisfactory-calc-last-chart";

export type ChartPersistExtras = {
  storageReserves?: Record<string, number>;
  autoBalanceEnabled?: boolean;
  /** Minimum belt tier for auto-balance (e.g. belt4 = Mk.4); still upgrades if throughput requires */
  preferredBeltKey?: string;
};

export type SavedChart = {
  id: string;
  name: string;
  tree: TreeNode;
  /** items/min the user wants to keep as intentional surplus (Storage panel) */
  storageReserves?: Record<string, number>;
  autoBalanceEnabled?: boolean;
  preferredBeltKey?: string;
  updatedAt: number;
};

function loadRaw(): { charts: Record<string, Omit<SavedChart, "tree"> & { tree: unknown }> } {
  if (typeof window === "undefined") return { charts: {} };
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return { charts: {} };
    return JSON.parse(s) as { charts: Record<string, Omit<SavedChart, "tree"> & { tree: unknown }> };
  } catch {
    return { charts: {} };
  }
}

export function getSavedCharts(): SavedChart[] {
  const { charts } = loadRaw();
  return Object.values(charts)
    .map((c) => ({ ...c, tree: c.tree as TreeNode }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type LoadedChart = {
  tree: TreeNode;
  storageReserves: Record<string, number>;
  autoBalanceEnabled: boolean;
  preferredBeltKey: string;
};

const DEFAULT_PREFERRED_BELT = "belt4";

export function loadChart(id: string): LoadedChart | null {
  const { charts } = loadRaw();
  const c = charts[id];
  if (!c?.tree) return null;
  const raw = c as SavedChart & { tree: unknown };
  const reserves = raw.storageReserves;
  const storageReserves: Record<string, number> =
    reserves && typeof reserves === "object"
      ? Object.fromEntries(
          Object.entries(reserves).filter(([, v]) => typeof v === "number" && v > 0)
        )
      : {};
  const autoBalanceEnabled = raw.autoBalanceEnabled === true;
  const preferredBeltKey =
    typeof raw.preferredBeltKey === "string" && raw.preferredBeltKey.length > 0
      ? raw.preferredBeltKey
      : DEFAULT_PREFERRED_BELT;
  return { tree: c.tree as TreeNode, storageReserves, autoBalanceEnabled, preferredBeltKey };
}

export function saveChart(
  id: string,
  name: string,
  tree: TreeNode,
  extras: ChartPersistExtras = {}
): void {
  const { charts } = loadRaw();
  const storageReserves = extras.storageReserves ?? {};
  const cleaned =
    Object.keys(storageReserves).length > 0
      ? Object.fromEntries(Object.entries(storageReserves).filter(([, v]) => v > 0))
      : undefined;
  const autoBalanceEnabled = extras.autoBalanceEnabled === true;
  const preferredBeltKey =
    typeof extras.preferredBeltKey === "string" && extras.preferredBeltKey.length > 0
      ? extras.preferredBeltKey
      : DEFAULT_PREFERRED_BELT;
  charts[id] = {
    id,
    name,
    tree,
    ...(cleaned && Object.keys(cleaned).length > 0 ? { storageReserves: cleaned } : {}),
    ...(autoBalanceEnabled ? { autoBalanceEnabled: true } : {}),
    ...(preferredBeltKey !== DEFAULT_PREFERRED_BELT ? { preferredBeltKey } : {}),
    updatedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ charts }));
  localStorage.setItem(LAST_CHART_KEY, id);
}

export function deleteChart(id: string): void {
  const { charts } = loadRaw();
  delete charts[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ charts }));
  if (localStorage.getItem(LAST_CHART_KEY) === id) {
    const remaining = Object.keys(charts);
    localStorage.setItem(LAST_CHART_KEY, remaining[0] ?? "");
  }
}

export function getLastChartId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_CHART_KEY);
}

export function generateChartId(): string {
  return `chart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
