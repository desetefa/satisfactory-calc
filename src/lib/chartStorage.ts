/**
 * localStorage persistence for flow charts and workspaces.
 *
 * Legacy model: one SavedChart per "chart"
 * New model:    WorkspaceDoc (top-level) → FactoryRecord[] (factories within a workspace)
 *
 * Migration: each old SavedChart becomes a WorkspaceDoc with a single FactoryRecord.
 */

import type { TreeNode } from "@/lib/flowChartModel";
import type { KeyName } from "@/lib/types";

// ─── Legacy types (kept for migration) ───────────────────────────────────────

const LEGACY_STORAGE_KEY = "satisfactory-calc-charts";
const LEGACY_LAST_KEY = "satisfactory-calc-last-chart";

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
  storageReserves?: Record<string, number>;
  autoBalanceEnabled?: boolean;
  preferredBeltKey?: string;
  updatedAt: number;
};

// ─── New workspace types ──────────────────────────────────────────────────────

/** An item flowing OUT of a factory to another factory. */
export type FactoryExport = {
  id: string;
  /** ID of the factory that receives this export. */
  toFactoryId: string;
  itemKey: KeyName;
  ratePerMin: number;
};

/** An item flowing INTO a factory from another factory (mirrors a FactoryExport). */
export type FactoryImport = {
  id: string;
  /** Same id as the corresponding FactoryExport. */
  fromFactoryId: string;
  itemKey: KeyName;
  ratePerMin: number;
};

/** A single production area / floor within a workspace. */
export type FactoryRecord = {
  id: string;
  name: string;
  tree: TreeNode;
  storageReserves?: Record<string, number>;
  autoBalanceEnabled?: boolean;
  preferredBeltKey?: string;
  exports: FactoryExport[];
  imports: FactoryImport[];
};

/** Top-level document — one per "project" the user works on. */
export type WorkspaceDoc = {
  id: string;
  name: string;
  factories: FactoryRecord[];
  updatedAt: number;
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

const WORKSPACE_KEY = "satisfactory-calc-workspaces";
const LAST_WORKSPACE_KEY = "satisfactory-calc-last-workspace";
const DEFAULT_PREFERRED_BELT = "belt4";

// ─── ID generators ────────────────────────────────────────────────────────────

export function generateWorkspaceId(): string {
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateFactoryId(): string {
  return `fac-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @deprecated Use generateWorkspaceId / generateFactoryId */
export function generateChartId(): string {
  return `chart-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Raw load/save helpers ────────────────────────────────────────────────────

function loadRawWorkspaces(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const s = localStorage.getItem(WORKSPACE_KEY);
    if (!s) return {};
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function loadRawLegacy(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const s = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!s) return {};
    const parsed = JSON.parse(s) as { charts?: Record<string, unknown> };
    return parsed.charts ?? {};
  } catch {
    return {};
  }
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Idempotent: reads legacy charts and creates a WorkspaceDoc for each one.
 * Skips charts that have already been migrated (tracked via a migration set).
 */
export function migrateChartsToWorkspaces(): void {
  if (typeof window === "undefined") return;
  const legacyCharts = loadRawLegacy();
  if (Object.keys(legacyCharts).length === 0) return;

  const workspaces = loadRawWorkspaces();
  // Track which legacy IDs have already been migrated
  const migratedKey = "satisfactory-calc-migrated-charts";
  let migrated: Set<string>;
  try {
    migrated = new Set(JSON.parse(localStorage.getItem(migratedKey) ?? "[]") as string[]);
  } catch {
    migrated = new Set();
  }

  let didMigrate = false;
  for (const [chartId, rawChart] of Object.entries(legacyCharts)) {
    if (migrated.has(chartId)) continue;
    const chart = rawChart as SavedChart;
    if (!chart?.tree) continue;

    const wsId = `ws-migrated-${chartId}`;
    const facId = `fac-migrated-${chartId}`;
    const factory: FactoryRecord = {
      id: facId,
      name: chart.name,
      tree: chart.tree,
      storageReserves: chart.storageReserves,
      autoBalanceEnabled: chart.autoBalanceEnabled,
      preferredBeltKey: chart.preferredBeltKey,
      exports: [],
      imports: [],
    };
    const workspace: WorkspaceDoc = {
      id: wsId,
      name: chart.name,
      factories: [factory],
      updatedAt: chart.updatedAt ?? Date.now(),
    };
    workspaces[wsId] = workspace;
    migrated.add(chartId);
    didMigrate = true;
  }

  if (didMigrate) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaces));
    localStorage.setItem(migratedKey, JSON.stringify([...migrated]));
    // Map last-chart → last-workspace
    const lastChart = localStorage.getItem(LEGACY_LAST_KEY);
    if (lastChart && !localStorage.getItem(LAST_WORKSPACE_KEY)) {
      localStorage.setItem(LAST_WORKSPACE_KEY, `ws-migrated-${lastChart}`);
    }
  }
}

// ─── Workspace CRUD ───────────────────────────────────────────────────────────

export function getSavedWorkspaces(): WorkspaceDoc[] {
  const raw = loadRawWorkspaces();
  return (Object.values(raw) as WorkspaceDoc[])
    .filter((w) => w?.id && Array.isArray(w.factories))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadWorkspace(id: string): WorkspaceDoc | null {
  const raw = loadRawWorkspaces();
  const doc = raw[id] as WorkspaceDoc | undefined;
  if (!doc?.factories) return null;
  return doc;
}

export function saveWorkspace(doc: WorkspaceDoc): void {
  const raw = loadRawWorkspaces();
  raw[doc.id] = { ...doc, updatedAt: Date.now() };
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(raw));
  localStorage.setItem(LAST_WORKSPACE_KEY, doc.id);
}

export function deleteWorkspace(id: string): void {
  const raw = loadRawWorkspaces();
  delete raw[id];
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(raw));
  if (localStorage.getItem(LAST_WORKSPACE_KEY) === id) {
    const remaining = Object.keys(raw);
    localStorage.setItem(LAST_WORKSPACE_KEY, remaining[0] ?? "");
  }
}

export function getLastWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_WORKSPACE_KEY) || null;
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Create a new blank factory. */
export function createEmptyFactory(name: string, tree: TreeNode): FactoryRecord {
  return {
    id: generateFactoryId(),
    name,
    tree,
    exports: [],
    imports: [],
  };
}

/**
 * Add an export from `srcFactory` to `dstFactory`, creating a matching import.
 * Returns updated copies of both factories.
 */
export function addFactoryConnection(
  srcFactory: FactoryRecord,
  dstFactory: FactoryRecord,
  itemKey: KeyName,
  ratePerMin: number
): { src: FactoryRecord; dst: FactoryRecord } {
  const exportId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newExport: FactoryExport = {
    id: exportId,
    toFactoryId: dstFactory.id,
    itemKey,
    ratePerMin,
  };
  const newImport: FactoryImport = {
    id: exportId,
    fromFactoryId: srcFactory.id,
    itemKey,
    ratePerMin,
  };
  return {
    src: { ...srcFactory, exports: [...srcFactory.exports, newExport] },
    dst: { ...dstFactory, imports: [...dstFactory.imports, newImport] },
  };
}

/** Remove a connection by export ID from both factories in a workspace. */
export function removeFactoryConnection(
  workspace: WorkspaceDoc,
  exportId: string
): WorkspaceDoc {
  return {
    ...workspace,
    factories: workspace.factories.map((f) => ({
      ...f,
      exports: f.exports.filter((e) => e.id !== exportId),
      imports: f.imports.filter((i) => i.id !== exportId),
    })),
  };
}

/** Compute the effective external supply for a factory from its imports. */
export function getImportSupply(factory: FactoryRecord): Map<KeyName, number> {
  const supply = new Map<KeyName, number>();
  for (const imp of factory.imports) {
    supply.set(imp.itemKey, (supply.get(imp.itemKey) ?? 0) + imp.ratePerMin);
  }
  return supply;
}

/** Resolved defaults when reading a factory's settings. */
export function resolveFactorySettings(factory: FactoryRecord): {
  storageReserves: Record<string, number>;
  autoBalanceEnabled: boolean;
  preferredBeltKey: string;
} {
  return {
    storageReserves: factory.storageReserves ?? {},
    autoBalanceEnabled: factory.autoBalanceEnabled === true,
    preferredBeltKey:
      typeof factory.preferredBeltKey === "string" && factory.preferredBeltKey.length > 0
        ? factory.preferredBeltKey
        : DEFAULT_PREFERRED_BELT,
  };
}

// ─── Legacy API (kept for backward compat; delegates to workspace layer) ─────

export function getSavedCharts(): SavedChart[] {
  const raw = loadRawLegacy();
  return Object.values(raw)
    .map((c) => ({ ...(c as SavedChart), tree: (c as SavedChart).tree as TreeNode }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type LoadedChart = {
  tree: TreeNode;
  storageReserves: Record<string, number>;
  autoBalanceEnabled: boolean;
  preferredBeltKey: string;
};

export function loadChart(id: string): LoadedChart | null {
  const raw = loadRawLegacy();
  const c = raw[id] as SavedChart | undefined;
  if (!c?.tree) return null;
  const reserves = c.storageReserves;
  const storageReserves: Record<string, number> =
    reserves && typeof reserves === "object"
      ? Object.fromEntries(
          Object.entries(reserves).filter(([, v]) => typeof v === "number" && v > 0)
        )
      : {};
  return {
    tree: c.tree as TreeNode,
    storageReserves,
    autoBalanceEnabled: c.autoBalanceEnabled === true,
    preferredBeltKey:
      typeof c.preferredBeltKey === "string" && c.preferredBeltKey.length > 0
        ? c.preferredBeltKey
        : DEFAULT_PREFERRED_BELT,
  };
}

export function saveChart(
  id: string,
  name: string,
  tree: TreeNode,
  extras: ChartPersistExtras = {}
): void {
  const raw = loadRawLegacy();
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
  (raw as Record<string, unknown>)[id] = {
    id,
    name,
    tree,
    ...(cleaned && Object.keys(cleaned).length > 0 ? { storageReserves: cleaned } : {}),
    ...(autoBalanceEnabled ? { autoBalanceEnabled: true } : {}),
    ...(preferredBeltKey !== DEFAULT_PREFERRED_BELT ? { preferredBeltKey } : {}),
    updatedAt: Date.now(),
  };
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ charts: raw }));
  localStorage.setItem(LEGACY_LAST_KEY, id);
}

export function deleteChart(id: string): void {
  const raw = loadRawLegacy();
  delete (raw as Record<string, unknown>)[id];
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ charts: raw }));
  if (localStorage.getItem(LEGACY_LAST_KEY) === id) {
    const remaining = Object.keys(raw);
    localStorage.setItem(LEGACY_LAST_KEY, remaining[0] ?? "");
  }
}

export function getLastChartId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LEGACY_LAST_KEY);
}
