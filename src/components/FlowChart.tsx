"use client";

import { useState, useEffect, startTransition, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { KeyName } from "@/lib/types";
import {
  getExtractorMachineOptionsFull,
  getMachineOptionsForInput,
} from "@/lib/chain";
import {
  type WorkspaceDoc,
  type FactoryRecord,
  generateWorkspaceId,
  generateFactoryId,
  getSavedWorkspaces,
  loadWorkspace,
  saveWorkspace,
  deleteWorkspace,
  getLastWorkspaceId,
  migrateChartsToWorkspaces,
  resolveFactorySettings,
  getImportSupply,
} from "@/lib/chartStorage";
import { QuickBuildModal } from "@/components/QuickBuildModal";
import { BuildInventoryModal } from "@/components/flow-chart/BuildInventoryModal";
import { ConfirmModal } from "@/components/flow-chart/ConfirmModal";
import { SaveAsModal } from "@/components/flow-chart/SaveAsModal";
import { StorageStrip, type StorageStripRow } from "@/components/flow-chart/StorageStrip";
import { sliceDragDebug } from "@/components/flow-chart/sliceDragDebug";
import { FactoryEditModal } from "@/components/flow-chart/FactoryEditModal";
import { TreeLevelSlices } from "@/components/flow-chart/TreeLevelSlices";
import {
  type FlowNode,
  type InputEdge,
  type TreeNode,
  createFlowNode,
  createTreeNode,
  getTotalClockFraction,
} from "@/lib/flowChartModel";
import { planProductionFromTarget, primeQuickBuildTemplates } from "@/lib/productionPlanner";
import { productionPlanToSliceTree } from "@/lib/plannerToTree";
import {
  EMPTY_FLOW_RELATED_IDS,
  findNode,
  getDisplaySlices,
  getRelatedNodeIdsForHover,
  moveNodeDisplaySlice,
  reorderNodeInColumn,
  replaceNode,
  reorderSiblingBefore,
} from "@/lib/flowChartTree";
import { computeBuildInventory, computeBuildInventoryForTrees } from "@/lib/flowChartBuildInventory";
import {
  computeFlowBalanceMaps,
  computeFlowRates,
  getAllNodes,
} from "@/lib/flowChartFlowRates";
import {
  autoBalanceAfterEdit,
  autoBalanceAncestorChain,
  optimizeStorageItemNoWaste,
  satisfyStorageReserveForItem,
} from "@/lib/flowChartStorageBalance";
import {
  addChildToNode,
  breakOutMachine,
  mergeNodesAcrossParents,
  mergeNodesAsChild,
  recalcTree,
  splitMergedNode,
  synthesizeMissingInputEdges,
  updateAllBeltsInTree,
  updateChildBeltInTree,
  updateInputEdgeBeltInTree,
  updateNodeInTree,
} from "@/lib/flowChartTreeMutations";
import { formatRate, getItemName } from "@/components/flow-chart/flowChartDisplay";
import { FLOW_CHART_BELTS } from "@/components/flow-chart/flowChartConstants";
import type { MachineOption } from "@/components/flow-chart/flowChartTypes";
import { getBuilding, getMiner, getRecipe } from "@/lib/db";
import { normalizeTransportForItem } from "@/lib/flowTransport";

export type { NodePurity, FlowNode, InputEdge, TreeNode } from "@/lib/flowChartModel";
export type { FlowInputData, FlowRateData } from "@/lib/flowChartFlowTypes";

const createNode = createFlowNode;

/** Belt list for inline selects in this file (matches {@link FLOW_CHART_BELTS}). */
const BELTS = FLOW_CHART_BELTS;

const EMPTY_TREE = createTreeNode(createNode("", "", "", 0, 0, 100, {}), null);

const INITIAL_FACTORY_ID = "fac-initial";
const INITIAL_WORKSPACE_ID = "ws-initial";

const INITIAL_WORKSPACE: WorkspaceDoc = {
  id: INITIAL_WORKSPACE_ID,
  name: "Untitled",
  factories: [
    {
      id: INITIAL_FACTORY_ID,
      name: "Factory 1",
      tree: EMPTY_TREE,
      exports: [],
      imports: [],
    },
  ],
  updatedAt: 0,
};

/** Read saved workspace from localStorage (client-only). */
function readPersistedBoot(): { workspace: WorkspaceDoc; savedWorkspaces: WorkspaceDoc[] } {
  migrateChartsToWorkspaces();
  const workspaces = getSavedWorkspaces();
  const lastId = getLastWorkspaceId();
  const defaults = { workspace: INITIAL_WORKSPACE, savedWorkspaces: workspaces };
  if (!lastId) return defaults;
  const loaded = loadWorkspace(lastId);
  if (!loaded || loaded.factories.length === 0) return defaults;
  // Recalc trees on load
  const workspace: WorkspaceDoc = {
    ...loaded,
    factories: loaded.factories.map((f) => ({
      ...f,
      tree: recalcTree(synthesizeMissingInputEdges(f.tree)),
    })),
  };
  return { workspace, savedWorkspaces: workspaces };
}

export function FlowChart() {
  // ── Workspace state ──────────────────────────────────────────────────────────
  const [workspace, _setWorkspace] = useState<WorkspaceDoc>(INITIAL_WORKSPACE);
  const pastRef = useRef<WorkspaceDoc[]>([]);
  const futureRef = useRef<WorkspaceDoc[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /** Tracked setter — every call creates an undo entry. */
  const setWorkspace = useCallback(
    (updaterOrValue: WorkspaceDoc | ((ws: WorkspaceDoc) => WorkspaceDoc)) => {
      _setWorkspace((current) => {
        const next =
          typeof updaterOrValue === "function" ? updaterOrValue(current) : updaterOrValue;
        pastRef.current = [...pastRef.current.slice(-49), current];
        futureRef.current = [];
        return next;
      });
      setCanUndo(true);
      setCanRedo(false);
    },
    []
  );

  /** Non-tracked reset — clears history (used for boot / load / new workspace). */
  const resetWorkspace = useCallback((ws: WorkspaceDoc) => {
    pastRef.current = [];
    futureRef.current = [];
    _setWorkspace(ws);
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    _setWorkspace((current) => {
      const prev = pastRef.current[pastRef.current.length - 1]!;
      futureRef.current = [current, ...futureRef.current].slice(0, 50);
      pastRef.current = pastRef.current.slice(0, -1);
      return prev;
    });
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    _setWorkspace((current) => {
      const next = futureRef.current[0]!;
      pastRef.current = [...pastRef.current, current].slice(-50);
      futureRef.current = futureRef.current.slice(1);
      return next;
    });
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const [activeFactoryId, setActiveFactoryId] = useState<string>(INITIAL_FACTORY_ID);
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceDoc[]>([]);
  const [editingFactoryId, setEditingFactoryId] = useState<string | null>(null);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDropdownAnchor, setMenuDropdownAnchor] = useState<{ top: number; right: number } | null>(null);
  const [factoryActionTooltip, setFactoryActionTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [buildInventoryOpen, setBuildInventoryOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: "workspace"; id: string; name: string }
    | { kind: "factory"; id: string; name: string }
    | null
  >(null);
  const [separateAction, setSeparateAction] = useState<(() => void) | null>(null);
  const [storagePanelVisible, setStoragePanelVisible] = useState(true);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // ── Derived: active factory ───────────────────────────────────────────────────
  const activeFactory: FactoryRecord =
    workspace.factories.find((f) => f.id === activeFactoryId) ??
    workspace.factories[0] ??
    INITIAL_WORKSPACE.factories[0]!;

  const { storageReserves, autoBalanceEnabled, preferredBeltKey } = resolveFactorySettings(activeFactory);
  const tree = activeFactory.tree;

  // ── Factory update helper ─────────────────────────────────────────────────────
  const updateActiveFactory = useCallback(
    (updater: (f: FactoryRecord) => FactoryRecord) => {
      setWorkspace((ws) => ({
        ...ws,
        factories: ws.factories.map((f) =>
          f.id === (ws.factories.find((x) => x.id === activeFactoryId)?.id ?? ws.factories[0]?.id)
            ? updater(f)
            : f
        ),
      }));
    },
    [activeFactoryId, setWorkspace]
  );

  // ── Derived setters ───────────────────────────────────────────────────────────
  const setTree = useCallback(
    (updater: TreeNode | ((prev: TreeNode) => TreeNode)) => {
      updateActiveFactory((f) => ({
        ...f,
        tree: typeof updater === "function" ? updater(f.tree) : updater,
      }));
    },
    [updateActiveFactory]
  );

  const setStorageReserves = useCallback(
    (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
      updateActiveFactory((f) => ({
        ...f,
        storageReserves:
          typeof updater === "function" ? updater(f.storageReserves ?? {}) : updater,
      }));
    },
    [updateActiveFactory]
  );

  const setAutoBalanceEnabled = useCallback(
    (val: boolean) => {
      updateActiveFactory((f) => ({ ...f, autoBalanceEnabled: val }));
    },
    [updateActiveFactory]
  );

  const setPreferredBeltKey = useCallback(
    (val: string) => {
      updateActiveFactory((f) => ({ ...f, preferredBeltKey: val }));
    },
    [updateActiveFactory]
  );

  const handleChangeAllBelts = useCallback(() => {
    setTree((t) => recalcTree(synthesizeMissingInputEdges(updateAllBeltsInTree(t, preferredBeltKey))));
  }, [preferredBeltKey, setTree]);

  // ── Boot from localStorage ────────────────────────────────────────────────────
  useEffect(() => {
    const boot = readPersistedBoot();
    startTransition(() => {
      resetWorkspace(boot.workspace);
      setSavedWorkspaces(boot.savedWorkspaces);
      const firstId = boot.workspace.factories[0]?.id;
      if (firstId) setActiveFactoryId(firstId);
    });
  }, [resetWorkspace]);

  // Prime quick-build templates after initial mount to reduce first-open latency.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    const runPrime = () => {
      primeQuickBuildTemplates();
    };
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(runPrime);
    } else {
      timeoutId = window.setTimeout(runPrime, 0);
    }
    return () => {
      if (idleId !== null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  // ── Keyboard shortcuts (undo / redo) ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // ── Workspace persistence handlers ───────────────────────────────────────────
  const loadWorkspaceById = useCallback((id: string) => {
    const loaded = loadWorkspace(id);
    if (!loaded || loaded.factories.length === 0) return;
    const ws: WorkspaceDoc = {
      ...loaded,
      factories: loaded.factories.map((f) => ({
        ...f,
        tree: recalcTree(synthesizeMissingInputEdges(f.tree)),
      })),
    };
    resetWorkspace(ws);
    setSavedWorkspaces(getSavedWorkspaces());
    setActiveFactoryId(ws.factories[0]?.id ?? INITIAL_FACTORY_ID);
  }, [resetWorkspace]);

  const handleNewWorkspace = useCallback(() => {
    const wsId = generateWorkspaceId();
    const facId = generateFactoryId();
    const newWs: WorkspaceDoc = {
      id: wsId,
      name: "Untitled",
      factories: [
        { id: facId, name: "Factory 1", tree: EMPTY_TREE, exports: [], imports: [] },
      ],
      updatedAt: Date.now(),
    };
    resetWorkspace(newWs);
    setActiveFactoryId(facId);
  }, [resetWorkspace]);

  const handleSave = useCallback(() => {
    if (workspace.id && workspace.id !== INITIAL_WORKSPACE_ID) {
      saveWorkspace(workspace);
      setSavedWorkspaces(getSavedWorkspaces());
    } else {
      setSaveAsOpen(true);
    }
  }, [workspace]);

  const handleSaveAs = useCallback(
    (name: string) => {
      const wsId = workspace.id && workspace.id !== INITIAL_WORKSPACE_ID
        ? workspace.id
        : generateWorkspaceId();
      const saved: WorkspaceDoc = { ...workspace, id: wsId, name };
      saveWorkspace(saved);
      resetWorkspace(saved);
      setSavedWorkspaces(getSavedWorkspaces());
      setSaveAsOpen(false);
    },
    [workspace, resetWorkspace]
  );

  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      deleteWorkspace(id);
      const remaining = getSavedWorkspaces();
      setSavedWorkspaces(remaining);
      if (workspace.id === id) {
        if (remaining.length > 0) {
          loadWorkspaceById(remaining[0].id);
        } else {
          handleNewWorkspace();
        }
      }
    },
    [workspace.id, loadWorkspaceById, handleNewWorkspace]
  );

  // ── Factory tab management ────────────────────────────────────────────────────
  const handleAddFactory = useCallback(() => {
    const facId = generateFactoryId();
    const newFactory: FactoryRecord = {
      id: facId,
      name: `Factory ${workspace.factories.length + 1}`,
      tree: EMPTY_TREE,
      exports: [],
      imports: [],
    };
    setWorkspace((ws) => ({ ...ws, factories: [...ws.factories, newFactory] }));
    setActiveFactoryId(facId);
  }, [workspace.factories.length, setWorkspace]);

  const handleRenameFactory = useCallback(
    (factoryId: string, newName: string) => {
      setWorkspace((ws) => ({
        ...ws,
        factories: ws.factories.map((f) =>
          f.id === factoryId ? { ...f, name: newName.trim() || f.name } : f
        ),
      }));
    },
    [setWorkspace]
  );

  const handleDeleteFactory = useCallback(
    (factoryId: string) => {
      if (workspace.factories.length <= 1) return;
      const newFactories = workspace.factories.filter((f) => f.id !== factoryId);
      setWorkspace((ws) => ({ ...ws, factories: newFactories }));
      if (activeFactoryId === factoryId) {
        setActiveFactoryId(newFactories[0]?.id ?? INITIAL_FACTORY_ID);
      }
    },
    [workspace.factories, activeFactoryId, setWorkspace]
  );

  // ── Connection management (exports / imports) ────────────────────────────────
  const handleRemoveConnection = useCallback((exportId: string) => {
    setWorkspace((ws) => ({
      ...ws,
      factories: ws.factories.map((f) => ({
        ...f,
        exports: f.exports.filter((e) => e.id !== exportId),
        imports: f.imports.filter((i) => i.id !== exportId),
      })),
    }));
  }, [setWorkspace]);

  const isEmpty = !tree.node.outputItemKey;

  const addMachine = useCallback(
    (
      parentTreeNode: TreeNode,
      option: {
        recipeKey: string;
        recipeName: string;
        buildingKey: string;
        buildingName: string;
        outputItemKey: KeyName;
        outputPerMachine: number;
        inputPerMachine: number;
      },
      insertAtIndex?: number,
      inputEdges?: InputEdge[],
      displaySliceIndex?: number
    ) => {
      const isExtractor = (option.inputPerMachine ?? 0) === 0;
      const n = createNode(
        option.outputItemKey,
        option.buildingKey,
        option.buildingName,
        option.outputPerMachine,
        1,
        100,
        {
          recipeKey: option.recipeKey,
          recipeName: option.recipeName,
          inputPerMachine: option.inputPerMachine,
          isRaw: isExtractor,
        }
      );

      if (!parentTreeNode.node.outputItemKey) {
        setTree(createTreeNode(n, null, []));
        return;
      }

      const siblingOutputs = parentTreeNode.children.map((c) => c.node.outputItemKey);
      const isBranch = siblingOutputs.includes(option.outputItemKey);
      const idx = insertAtIndex ?? (isBranch ? 0 : parentTreeNode.children.length);
      const preferredEdges = inputEdges?.map((e) => ({
        ...e,
        beltKey: normalizeTransportForItem(e.itemKey, preferredBeltKey),
      }));
      let updated = addChildToNode(tree, parentTreeNode.id, n, idx, preferredEdges, displaySliceIndex);
      updated = updateChildBeltInTree(
        updated,
        parentTreeNode.id,
        n.id,
        normalizeTransportForItem(parentTreeNode.node.outputItemKey, preferredBeltKey)
      );
      updated = recalcTree(synthesizeMissingInputEdges(updated));
      const inserted = findNode(updated, n.id);
      if (inserted?.inputEdges?.length) {
        for (const edge of inserted.inputEdges) {
          updated = updateInputEdgeBeltInTree(
            updated,
            n.id,
            edge.itemKey,
            normalizeTransportForItem(edge.itemKey, preferredBeltKey)
          );
        }
        updated = recalcTree(synthesizeMissingInputEdges(updated));
      }
      if (autoBalanceEnabled) {
        updated = autoBalanceAncestorChain(updated, n.id, preferredBeltKey);
      }
      setTree(updated);
    },
    [tree, autoBalanceEnabled, preferredBeltKey, setTree]
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<FlowNode>) => {
      let updated = updateNodeInTree(tree, nodeId, updates);
      updated = recalcTree(updated);
      if (autoBalanceEnabled) {
        updated = autoBalanceAncestorChain(updated, nodeId, preferredBeltKey);
      }
      setTree(updated);
    },
    [tree, autoBalanceEnabled, preferredBeltKey, setTree]
  );

  const setNodeMachine = useCallback(
    (nodeId: string, option: MachineOption) => {
      updateNode(nodeId, {
        outputItemKey: option.outputItemKey,
        outputItemName: getItemName(option.outputItemKey),
        buildingKey: option.buildingKey,
        buildingName: option.buildingName,
        outputPerMachine: option.outputPerMachine,
        recipeKey: option.recipeKey,
        recipeName: option.recipeName,
        inputPerMachine: option.inputPerMachine,
      });
    },
    [updateNode]
  );

  const removeNode = useCallback(
    (parentId: string | null, nodeId: string) => {
      if (!parentId) return;
      const parent = findNode(tree, parentId);
      if (!parent) return;
      const newChildren = parent.children.filter((c) => c.id !== nodeId);
      const updated = replaceNode(tree, parentId, (t) => ({
        ...t,
        children: newChildren,
      }));
      setTree(recalcTree(updated));
    },
    [tree, setTree]
  );

  const updateChildBelt = useCallback((parentId: string, childId: string, incomingBeltKey: string) => {
    setTree((t) => updateChildBeltInTree(t, parentId, childId, incomingBeltKey));
  }, [setTree]);

  const updateInputEdgeBelt = useCallback((consumerId: string, itemKey: KeyName, beltKey: string) => {
    setTree((t) => updateInputEdgeBeltInTree(t, consumerId, itemKey, beltKey));
  }, [setTree]);

  const mergeNodes = useCallback(
    (parentId: string, leftId: string, rightId: string) => {
      setTree(recalcTree(mergeNodesAsChild(tree, parentId, leftId, rightId)));
    },
    [tree, setTree]
  );

  const mergeCrossParent = useCallback(
    (leftId: string, rightId: string) => {
      setTree((t) => recalcTree(synthesizeMissingInputEdges(mergeNodesAcrossParents(t, leftId, rightId))));
    },
    [setTree]
  );

  const splitNodeHandler = useCallback(
    (parentId: string, nodeId: string) => {
      setTree(recalcTree(splitMergedNode(tree, parentId, nodeId)));
    },
    [tree, setTree]
  );

  const breakOutMachineHandler = useCallback(
    (parentId: string, nodeId: string, machineIndex: number) => {
      setTree((t) =>
        recalcTree(synthesizeMissingInputEdges(breakOutMachine(t, parentId, nodeId, machineIndex)))
      );
    },
    [setTree]
  );

  const importSupply = useMemo(() => getImportSupply(activeFactory), [activeFactory]);

  /** Resolved import rows for the slice 0 INPUT header */
  const factoryImportRows = useMemo(
    () =>
      activeFactory.imports.map((imp) => ({
        itemKey: imp.itemKey,
        ratePerMin: imp.ratePerMin,
        fromFactoryName:
          workspace.factories.find((f) => f.id === imp.fromFactoryId)?.name ?? "Unknown",
      })),
    [activeFactory.imports, workspace.factories]
  );

  const flowRates = useMemo(
    () =>
      tree.node.outputItemKey
        ? computeFlowRates(tree, importSupply.size > 0 ? importSupply : undefined)
        : new Map(),
    [tree, importSupply]
  );
  const factoryPowerById = useMemo(() => {
    const out = new Map<string, { generationMw: number; consumptionMw: number; netMw: number }>();
    for (const factory of workspace.factories) {
      const factoryTree = factory.tree;
      if (!factoryTree.node.outputItemKey) {
        out.set(factory.id, { generationMw: 0, consumptionMw: 0, netMw: 0 });
        continue;
      }
      const supply = getImportSupply(factory);
      const rates = computeFlowRates(factoryTree, supply.size > 0 ? supply : undefined);
      let generationMw = 0;
      let consumptionMw = 0;
      for (const n of getAllNodes(factoryTree)) {
        const fd = rates.get(n.id);
        if (n.node.outputItemKey === "power") {
          const generated = fd && "currentOutput" in fd ? fd.currentOutput : n.node.totalOutput;
          generationMw += generated;
        } else {
          const basePower =
            getBuilding(n.node.buildingKey)?.power ??
            getMiner(n.node.buildingKey)?.power ??
            0;
          consumptionMw += basePower * getTotalClockFraction(n.node);
        }
      }
      out.set(factory.id, {
        generationMw,
        consumptionMw,
        netMw: generationMw - consumptionMw,
      });
    }
    return out;
  }, [workspace.factories]);
  const powerStats = useMemo(() => {
    let generationMw = 0;
    let consumptionMw = 0;
    for (const stats of factoryPowerById.values()) {
      generationMw += stats.generationMw;
      consumptionMw += stats.consumptionMw;
    }
    return {
      generationMw,
      consumptionMw,
      netMw: generationMw - consumptionMw,
    };
  }, [factoryPowerById]);

  const [flowHoverNodeId, setFlowHoverNodeId] = useState<string | null>(null);
  const [flowPinnedNodeId, setFlowPinnedNodeId] = useState<string | null>(null);
  /** Ignore pin if that node no longer exists (no effect needed — derived here). */
  const effectiveFlowPin =
    flowPinnedNodeId && findNode(tree, flowPinnedNodeId) ? flowPinnedNodeId : null;
  /** Pinned node locks the branch highlight; hover only applies when nothing is pinned */
  const flowFocusNodeId = effectiveFlowPin ?? flowHoverNodeId;
  const flowFocusRelatedIds = useMemo(
    () =>
      flowFocusNodeId ? getRelatedNodeIdsForHover(tree, flowFocusNodeId) : EMPTY_FLOW_RELATED_IDS,
    [tree, flowFocusNodeId]
  );
  const toggleFlowPin = useCallback((id: string) => {
    setFlowPinnedNodeId((prev) => {
      const p = prev && findNode(tree, prev) ? prev : null;
      // Same node clicked again → unpin. Any other node → switch pin to it.
      return p === id ? null : id;
    });
  }, [tree]);

  const factoryBuildInventory = useMemo(() => computeBuildInventory(tree), [tree]);
  const workspaceBuildInventory = useMemo(
    () => computeBuildInventoryForTrees(workspace.factories.map((f) => f.tree)),
    [workspace.factories]
  );

  const storageRows = useMemo((): StorageStripRow[] => {
    if (!tree.node.outputItemKey) return [];
    const balance = computeFlowBalanceMaps(tree, flowRates);
    const keys = new Set<KeyName>();
    for (const [k, v] of balance.produced) {
      if (v > 1e-6) keys.add(k);
    }
    for (const k of Object.keys(storageReserves)) {
      if ((storageReserves[k] ?? 0) > 0) keys.add(k as KeyName);
    }
    return [...keys]
      .sort((a, b) => getItemName(a).localeCompare(getItemName(b)))
      .map((itemKey) => ({
        itemKey,
        itemName: getItemName(itemKey),
        surplusRate: Math.max(
          0,
          (balance.produced.get(itemKey) ?? 0) - (balance.consumed.get(itemKey) ?? 0)
        ),
        reservePerMin: storageReserves[itemKey as string] ?? 0,
      }));
  }, [tree, flowRates, storageReserves]);

  const adjustStorageReserve = useCallback((itemKey: KeyName, delta: number) => {
    setStorageReserves((prev) => {
      const cur = prev[itemKey as string] ?? 0;
      const n = Math.max(0, cur + delta);
      const next: Record<string, number> = { ...prev };
      if (n <= 0) delete next[itemKey as string];
      else next[itemKey as string] = n;
      queueMicrotask(() => {
        setTree((t0) =>
          n > 0
            ? satisfyStorageReserveForItem(t0, itemKey, next)
            : optimizeStorageItemNoWaste(t0, itemKey)
        );
      });
      return next;
    });
  }, [setStorageReserves, setTree]);

  const optimizeStorageRow = useCallback((itemKey: KeyName) => {
    setStorageReserves((prev) => {
      const next = { ...prev };
      delete next[itemKey as string];
      queueMicrotask(() => {
        setTree((t0) => optimizeStorageItemNoWaste(t0, itemKey));
      });
      return next;
    });
  }, [setStorageReserves, setTree]);

  const [quickBuildOpen, setQuickBuildOpen] = useState(false);
  const [quickBuildAsFactory, setQuickBuildAsFactory] = useState(false);
  const [quickBuildKey, setQuickBuildKey] = useState(0);
  const [quickBuildError, setQuickBuildError] = useState<string | null>(null);

  const handleQuickBuildConfirm = useCallback(
    (args: { productKey: KeyName; recipeKey: string; minerKey: string }) => {
      setQuickBuildError(null);
      const planned = planProductionFromTarget(
        { productKey: args.productKey, recipeKey: args.recipeKey },
        { minerKey: args.minerKey }
      );
      if (!planned.ok) {
        setQuickBuildError(planned.error);
        return;
      }
      try {
        const { tree, targetNodeId } = productionPlanToSliceTree(planned.plan);
        let t = recalcTree(synthesizeMissingInputEdges(tree));
        t = autoBalanceAfterEdit(t, targetNodeId, preferredBeltKey);
        if (quickBuildAsFactory) {
          const newFactoryId = generateFactoryId();
          const recipeName =
            getRecipe(args.recipeKey)?.name ?? getItemName(args.productKey, "comfortable");
          const newFactory: FactoryRecord = {
            id: newFactoryId,
            name: recipeName,
            tree: t,
            exports: [],
            imports: [],
            autoBalanceEnabled: true,
          };
          setWorkspace((ws) => ({
            ...ws,
            factories: [...ws.factories, newFactory],
          }));
          setActiveFactoryId(newFactoryId);
        } else {
          setTree(t);
          setAutoBalanceEnabled(true);
        }
        setQuickBuildOpen(false);
        setQuickBuildAsFactory(false);
      } catch (e) {
        setQuickBuildError(e instanceof Error ? e.message : "Failed to layout factory from plan.");
      }
    },
    [preferredBeltKey, quickBuildAsFactory, setAutoBalanceEnabled, setTree, setWorkspace]
  );

  const openQuickBuildFactory = useCallback(() => {
    setQuickBuildError(null);
    setQuickBuildAsFactory(true);
    setQuickBuildKey((k) => k + 1);
    setQuickBuildOpen(true);
  }, []);

  const closeQuickBuildModal = useCallback(() => {
    setQuickBuildOpen(false);
    setQuickBuildAsFactory(false);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuDropdownAnchor(null);
    setMenuOpen(false);
  }, []);

  const showFactoryActionTooltip = useCallback((text: string, target: HTMLElement | null) => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setFactoryActionTooltip({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
    });
  }, []);

  const hideFactoryActionTooltip = useCallback(() => {
    setFactoryActionTooltip(null);
  }, []);

  const storageStrip = (
    <StorageStrip
      rows={storageRows}
      onReserveDelta={adjustStorageReserve}
      onOptimizeRow={optimizeStorageRow}
      panelExpanded={storagePanelVisible}
      onExpandPanel={() => setStoragePanelVisible(true)}
      onDismiss={() => setStoragePanelVisible(false)}
    />
  );

  const storageRail = (
    <div
      className={`flex h-full shrink-0 justify-start overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none motion-reduce:duration-0 ${storagePanelVisible ? "w-64" : "w-10"}`}
    >
      {storageStrip}
    </div>
  );

  const isSaved = workspace.id && workspace.id !== INITIAL_WORKSPACE_ID &&
    savedWorkspaces.some((w) => w.id === workspace.id);

  const header = (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-900/30">
      {/* Row 1: workspace name + actions */}
      <div className="flex w-full items-center justify-between px-4 pt-3 pb-1">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold text-zinc-200">
              {workspace.name}
              {!isSaved && <span className="ml-1 text-xs font-normal text-zinc-500">(unsaved)</span>}
            </h1>
            {workspaceBuildInventory && workspaceBuildInventory.rows.length > 0 && (
              <button
                type="button"
                onClick={() => setBuildInventoryOpen(true)}
                className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
                title="Open build inventory"
              >
                Inventory
              </button>
            )}
            {!isEmpty && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 text-sm font-semibold ${
                  powerStats.netMw >= 0 ? "text-emerald-300" : "text-red-300"
                }`}
                title={`Generation ${formatRate(powerStats.generationMw)} MW · Consumption ${formatRate(powerStats.consumptionMw)} MW`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
                </svg>
                <span>{powerStats.netMw >= 0 ? "+" : ""}{formatRate(powerStats.netMw)} MW</span>
              </span>
            )}
          </div>
        </div>
        <div className="relative flex items-center gap-1">
          {/* Undo / Redo */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a4 4 0 0 1 0 8H9M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a4 4 0 0 0 0 8h4M21 10l-4-4M21 10l-4 4" />
            </svg>
          </button>
          {separateAction && (
            <button
              type="button"
              onClick={() => { separateAction(); setSeparateAction(null); }}
              className="rounded-lg p-2 text-amber-400 hover:bg-zinc-800 hover:text-amber-300"
              title="Separate"
              aria-label="Separate"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => {
              if (menuOpen) {
                closeMenu();
              } else {
                const rect = menuButtonRef.current?.getBoundingClientRect();
                if (rect && typeof window !== "undefined") {
                  setMenuDropdownAnchor({
                    top: rect.bottom + 8,
                    right: window.innerWidth - rect.right,
                  });
                }
                setMenuOpen(true);
              }
            }}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {menuOpen &&
            typeof document !== "undefined" &&
            createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden="true" />
                <div
                  className="fixed z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border-2 border-zinc-700 bg-zinc-900 p-2 shadow-xl"
                  style={menuDropdownAnchor ? { top: menuDropdownAnchor.top, right: menuDropdownAnchor.right } : undefined}
                >
                  {/* Workspace selector */}
                  <select
                    value={workspace.id && workspace.id !== INITIAL_WORKSPACE_ID ? workspace.id : "__unsaved__"}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id && id !== "__unsaved__") loadWorkspaceById(id);
                      closeMenu();
                    }}
                    className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                  >
                    <option value="__unsaved__">{workspace.name}{!isSaved ? " (unsaved)" : ""}</option>
                    {savedWorkspaces.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                  <div className="mb-2 rounded-lg border border-zinc-700 p-2">
                    <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={autoBalanceEnabled}
                        onChange={(e) => setAutoBalanceEnabled(e.target.checked)}
                        className="mt-0.5 rounded border-zinc-600"
                      />
                      <span>
                        <span className="font-medium text-zinc-200">Auto-balance</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                          After adds or edits, scale tree ancestors (parent→root) to meet belted demand. Surplus OK.
                        </span>
                      </span>
                    </label>
                    <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Min belt tier
                    </label>
                    <select
                      value={preferredBeltKey}
                      onChange={(e) => setPreferredBeltKey(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
                    >
                      {BELTS.map((b) => (
                        <option key={b.key_name} value={b.key_name}>
                          {b.name} ({formatRate(b.rate)}/min)
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-700 p-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={storagePanelVisible}
                      onChange={(e) => setStoragePanelVisible(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-600"
                    />
                    <span>
                      <span className="font-medium text-zinc-200">Storage panel</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        Show the surplus / reserve strip on the right.
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { handleNewWorkspace(); closeMenu(); }}
                    className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    New workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleSave(); closeMenu(); }}
                    className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSaveAsOpen(true); closeMenu(); }}
                    className="mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Save as…
                  </button>
                  {isSaved && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({ kind: "workspace", id: workspace.id, name: workspace.name });
                        closeMenu();
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800 hover:text-red-300"
                    >
                      Delete workspace
                    </button>
                  )}
                </div>
              </>,
              document.body
            )
          }
        </div>
      </div>

      {/* Row 2: factory tabs + belt controls */}
      <div className="flex items-center px-3 pb-2 pt-1 gap-0">
        {/* Scrollable tabs area */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {workspace.factories.map((factory) => (
          <div key={factory.id} className="relative flex items-center group">
            {/* Tab button group: name + edit + delete */}
            <div
              className={`flex items-center rounded-md border transition ${
                factory.id === activeFactoryId
                  ? "bg-amber-500/20 border-amber-500/40"
                  : "border-zinc-700/70 hover:bg-zinc-800"
              }`}
            >
              {/* Tab name button */}
              <button
                type="button"
                onClick={() => setActiveFactoryId(factory.id)}
                className={`px-3 py-1 text-sm font-medium transition ${
                  factory.id === activeFactoryId
                    ? "text-amber-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {factory.name}
                <span
                  className={`ml-2 text-xs font-semibold ${
                    (factoryPowerById.get(factory.id)?.netMw ?? 0) >= 0
                      ? "text-emerald-300"
                      : "text-red-300"
                  }`}
                  title={`Net power: ${
                    (factoryPowerById.get(factory.id)?.netMw ?? 0) >= 0 ? "+" : ""
                  }${formatRate(factoryPowerById.get(factory.id)?.netMw ?? 0)} MW`}
                >
                  {(factoryPowerById.get(factory.id)?.netMw ?? 0) >= 0 ? "+" : ""}
                  {formatRate(factoryPowerById.get(factory.id)?.netMw ?? 0)} MW
                </span>
                {(factory.exports.length > 0 || factory.imports.length > 0) && (
                  <span
                    className="ml-1.5 inline-flex items-center text-[10px] font-semibold text-amber-400/80"
                    title={
                      factory.exports.length > 0 && factory.imports.length > 0
                        ? "Exports and imports"
                        : factory.exports.length > 0
                          ? "Exports to other factories"
                          : "Imports from other factories"
                    }
                    aria-label={
                      factory.exports.length > 0 && factory.imports.length > 0
                        ? "Exports and imports"
                        : factory.exports.length > 0
                          ? "Exports"
                          : "Imports"
                    }
                  >
                    {factory.exports.length > 0 ? "↑" : ""}
                    {factory.imports.length > 0 ? "↓" : ""}
                  </span>
                )}
              </button>
              {/* Edit button — always visible on hover, always visible for active */}
              <button
                type="button"
                onClick={() => setEditingFactoryId(factory.id)}
                className={`flex h-5 w-5 items-center justify-center transition ${
                  factory.id === activeFactoryId
                    ? "text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                    : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-300"
                }`}
                title="Edit factory"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {/* Delete button (only when >1 factory) */}
              {workspace.factories.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm({ kind: "factory", id: factory.id, name: factory.name })}
                  className={`flex h-4 w-4 items-center justify-center transition-opacity ${
                    factory.id === activeFactoryId
                      ? "text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                      : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-300"
                  }`}
                  title="Remove factory"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
        {/* Add factory button */}
        <div className="ml-1 flex shrink-0">
          <button
            type="button"
            onClick={handleAddFactory}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Add empty factory"
            title="Add empty factory"
            onMouseEnter={(e) => showFactoryActionTooltip("Add empty factory", e.currentTarget)}
            onMouseLeave={hideFactoryActionTooltip}
            onFocus={(e) => showFactoryActionTooltip("Add empty factory", e.currentTarget)}
            onBlur={hideFactoryActionTooltip}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="ml-1 flex shrink-0">
          <button
            type="button"
            onClick={openQuickBuildFactory}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800 hover:text-amber-300"
            aria-label="Quick build factory from recipe"
            title="Quick build factory"
            onMouseEnter={(e) => showFactoryActionTooltip("Quick build factory", e.currentTarget)}
            onMouseLeave={hideFactoryActionTooltip}
            onFocus={(e) => showFactoryActionTooltip("Quick build factory", e.currentTarget)}
            onBlur={hideFactoryActionTooltip}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9l2 2 4-4" />
            </svg>
          </button>
        </div>
        </div>{/* end scrollable tabs */}

        {/* Belt tier selector + Change All */}
        {!isEmpty && (
          <div className="ml-2 flex shrink-0 items-center gap-1.5 border-l border-zinc-800 pl-3">
            <select
              value={preferredBeltKey}
              onChange={(e) => setPreferredBeltKey(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 transition hover:border-zinc-600"
              title="Default belt tier for new connections"
            >
              {BELTS.map((b) => (
                <option key={b.key_name} value={b.key_name}>
                  {b.name.replace("Conveyor Belt ", "")}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleChangeAllBelts}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
              title="Set every belt in this factory to the selected tier"
            >
              Change All
            </button>
          </div>
        )}
      </div>

      {/* Factory edit modal — use editingFactoryId (not activeFactoryId) as the export source */}
      {editingFactoryId && (() => {
        const editingFactory = workspace.factories.find((f) => f.id === editingFactoryId);
        if (!editingFactory) return null;
        const srcId = editingFactoryId;
        return (
          <FactoryEditModal
            factory={editingFactory}
            workspace={workspace}
            onRename={(newName) => handleRenameFactory(srcId, newName)}
            onAddExport={(toFactoryId, itemKey, ratePerMin) => {
              const exportId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              setWorkspace((ws) => ({
                ...ws,
                factories: ws.factories.map((f) => {
                  if (f.id === srcId)
                    return { ...f, exports: [...f.exports, { id: exportId, toFactoryId, itemKey, ratePerMin }] };
                  if (f.id === toFactoryId)
                    return { ...f, imports: [...f.imports, { id: exportId, fromFactoryId: srcId, itemKey, ratePerMin }] };
                  return f;
                }),
              }));
            }}
            onAddImport={(fromFactoryId, itemKey, ratePerMin) => {
              const exportId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              setWorkspace((ws) => ({
                ...ws,
                factories: ws.factories.map((f) => {
                  if (f.id === fromFactoryId) {
                    return {
                      ...f,
                      exports: [...f.exports, { id: exportId, toFactoryId: srcId, itemKey, ratePerMin }],
                    };
                  }
                  if (f.id === srcId) {
                    return {
                      ...f,
                      imports: [...f.imports, { id: exportId, fromFactoryId, itemKey, ratePerMin }],
                    };
                  }
                  return f;
                }),
              }));
            }}
            onRemoveConnection={handleRemoveConnection}
            onClose={() => setEditingFactoryId(null)}
          />
        );
      })()}

      {saveAsOpen && (
        <SaveAsModal
          currentName={workspace.name}
          onSave={handleSaveAs}
          onClose={() => setSaveAsOpen(false)}
        />
      )}
      {buildInventoryOpen && workspaceBuildInventory && (
        <BuildInventoryModal
          factoryName={activeFactory.name}
          factoryRows={factoryBuildInventory?.rows ?? []}
          factoryPowerShards={factoryBuildInventory?.powerShards ?? 0}
          workspaceRows={workspaceBuildInventory.rows}
          workspacePowerShards={workspaceBuildInventory.powerShards}
          onClose={() => setBuildInventoryOpen(false)}
        />
      )}
      {factoryActionTooltip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-100 -translate-x-1/2 -translate-y-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200 shadow-lg"
            style={{ left: factoryActionTooltip.x, top: factoryActionTooltip.y }}
          >
            {factoryActionTooltip.text}
          </div>,
          document.body
        )}
    </header>
  );

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {header}
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <main
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <div
            className="flex min-w-0 min-h-full w-fit items-stretch justify-start p-6"
          >
            <div className="flex min-h-full flex-1 flex-row items-stretch justify-start">
        <TreeLevelSlices
          treeNode={tree}
          tree={tree}
          flowRates={flowRates}
          machineOptions={
            tree.node.outputItemKey
              ? (tree.node.isRaw ? getExtractorMachineOptionsFull() : getMachineOptionsForInput(tree.node.outputItemKey))
              : []
          }
          parentOutputItemKey={undefined}
          onUpdateNode={updateNode}
          onSelectNodeMachine={setNodeMachine}
          onAddMachine={addMachine}
          onUpdateChildBelt={updateChildBelt}
          onUpdateInputEdgeBelt={updateInputEdgeBelt}
          onMergeNodes={mergeNodes}
          onMergeCrossParent={mergeCrossParent}
          onSplitNode={splitNodeHandler}
          onBreakOutMachine={breakOutMachineHandler}
          onRemove={undefined}
          removeNode={removeNode}
          onSetSeparateAction={setSeparateAction}
          flowFocusNodeId={flowFocusNodeId}
          flowFocusRelatedIds={flowFocusRelatedIds}
          onFlowNodeHoverEnter={setFlowHoverNodeId}
          onFlowNodeHoverLeave={() => setFlowHoverNodeId(null)}
          onFlowNodePinToggle={toggleFlowPin}
          onReorderSliceSiblings={(parentId, activeId, insertBeforeId) => {
            sliceDragDebug("FlowChart onReorderSliceSiblings", { parentId, activeId, insertBeforeId });
            setTree((t) =>
              recalcTree(synthesizeMissingInputEdges(reorderSiblingBefore(t, parentId, activeId, insertBeforeId)))
            );
          }}
          onReorderColumnPosition={(sliceIdx, activeId, insertBeforeId) => {
            sliceDragDebug("FlowChart onReorderColumnPosition", { sliceIdx, activeId, insertBeforeId });
            setTree((t) => {
              const colNodes = getDisplaySlices(t)[sliceIdx] ?? [];
              const colIds = colNodes.map((n) => n.id);
              return recalcTree(synthesizeMissingInputEdges(reorderNodeInColumn(t, activeId, insertBeforeId, colIds)));
            });
          }}
          onMoveNodeDisplaySlice={(parentId, activeId, targetSliceIdx, insertBeforeId) => {
            sliceDragDebug("FlowChart onMoveNodeDisplaySlice", {
              parentId,
              activeId,
              targetSliceIdx,
              insertBeforeId,
            });
            setTree((t) =>
              recalcTree(
                synthesizeMissingInputEdges(
                  moveNodeDisplaySlice(t, parentId, activeId, targetSliceIdx, insertBeforeId)
                )
              )
            );
          }}
          onQuickBuild={undefined}
          factoryImports={factoryImportRows}
          onClearTree={() => setTree(EMPTY_TREE)}
        />
            </div>
          </div>
        </main>
        {storageRail}
      </div>
    </div>
    <QuickBuildModal
      key={quickBuildKey}
      open={quickBuildOpen}
      onClose={closeQuickBuildModal}
      onConfirm={handleQuickBuildConfirm}
      error={quickBuildError}
      hasExistingChart={!quickBuildAsFactory && !isEmpty}
    />
    <ConfirmModal
      open={deleteConfirm !== null}
      title={
        deleteConfirm?.kind === "workspace"
          ? "Delete workspace?"
          : "Delete factory?"
      }
      message={
        deleteConfirm?.kind === "workspace"
          ? `Delete workspace "${deleteConfirm.name}"? This cannot be undone.`
          : `Delete factory "${deleteConfirm?.name ?? ""}"? This cannot be undone.`
      }
      confirmLabel={deleteConfirm?.kind === "workspace" ? "Delete workspace" : "Delete factory"}
      onCancel={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (!deleteConfirm) return;
        if (deleteConfirm.kind === "workspace") {
          handleDeleteWorkspace(deleteConfirm.id);
        } else {
          handleDeleteFactory(deleteConfirm.id);
        }
        setDeleteConfirm(null);
      }}
    />
    </>
  );
}

