/**
 * localStorage persistence for flow charts
 */

import type { TreeNode } from "@/components/FlowChart";

const STORAGE_KEY = "satisfactory-calc-charts";
const LAST_CHART_KEY = "satisfactory-calc-last-chart";

export type SavedChart = {
  id: string;
  name: string;
  tree: TreeNode;
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

export function loadChart(id: string): TreeNode | null {
  const { charts } = loadRaw();
  const c = charts[id];
  if (!c?.tree) return null;
  return c.tree as TreeNode;
}

export function saveChart(id: string, name: string, tree: TreeNode): void {
  const { charts } = loadRaw();
  charts[id] = {
    id,
    name,
    tree,
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
