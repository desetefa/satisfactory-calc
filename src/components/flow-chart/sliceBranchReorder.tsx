"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { sliceDragDebug } from "@/components/flow-chart/sliceDragDebug";

const SLICE_REORDER_LONG_PRESS_MS = 400;
const SLICE_REORDER_MOVE_CANCEL_PX = 12;

/** Screen rect for dashed insertion preview (fixed to viewport like the float clone). */
export type SliceInsertSlotRect = { top: number; left: number; width: number; height: number };

/** Column highlight + lock vertical scroll in slice stacks while any machine row is being dragged. */
const SliceDragColumnContext = createContext<{
  highlightSliceIdx: number | null;
  setHighlightSliceIdx: (idx: number | null) => void;
  sliceDragActive: boolean;
  setSliceDragActive: (v: boolean) => void;
  insertSlotRect: SliceInsertSlotRect | null;
  setInsertSlotRect: (r: SliceInsertSlotRect | null) => void;
} | null>(null);

export function SliceDragColumnProvider({ children }: { children: ReactNode }) {
  const [highlightSliceIdx, setHighlightSliceIdx] = useState<number | null>(null);
  const [sliceDragActive, setSliceDragActive] = useState(false);
  const [insertSlotRect, setInsertSlotRect] = useState<SliceInsertSlotRect | null>(null);
  const value = useMemo(
    () => ({
      highlightSliceIdx,
      setHighlightSliceIdx,
      sliceDragActive,
      setSliceDragActive,
      insertSlotRect,
      setInsertSlotRect,
    }),
    [highlightSliceIdx, sliceDragActive, insertSlotRect]
  );
  return (
    <SliceDragColumnContext.Provider value={value}>
      {children}
      {insertSlotRect != null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-10001 rounded-lg border-2 border-dashed border-amber-500/90 bg-amber-950/30 shadow-[inset_0_0_12px_rgba(245,158,11,0.15)]"
            style={{
              top: insertSlotRect.top,
              left: insertSlotRect.left,
              width: insertSlotRect.width,
              height: insertSlotRect.height,
            }}
            aria-hidden
          />,
          document.body
        )}
    </SliceDragColumnContext.Provider>
  );
}

export function useSliceDragColumn() {
  return useContext(SliceDragColumnContext);
}

/** Outer shell for one horizontal slice column: `data-slice-column` + drop-target highlight while dragging. */
export function SliceColumnSurface({
  sliceIdx,
  className,
  children,
}: {
  sliceIdx: number;
  className: string;
  children: ReactNode;
}) {
  const ctx = useSliceDragColumn();
  const isDropTarget = ctx != null && ctx.highlightSliceIdx === sliceIdx;
  return (
    <div
      data-slice-column={sliceIdx}
      className={`${className} ${
        isDropTarget
          ? "ring-2 ring-inset ring-amber-500/80 bg-amber-950/25 shadow-[inset_0_0_20px_rgba(245,158,11,0.12)]"
          : "transition-[box-shadow,background-color] duration-150"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * Insert-before target from viewport Y. Uses midpoints between consecutive row rects (including the
 * dragged row) so gaps between machines map to the correct slot; the old “midpoint of each other row
 * only” rule put the gap in the “append” zone and made vertical reorder a no-op.
 */
function computeInsertBeforeFromPointer(branch: HTMLElement, clientY: number, activeId: string): string | null {
  const rows = [...branch.querySelectorAll("[data-slice-machine-row]")] as HTMLElement[];
  if (rows.length === 0) return null;
  const rects = rows
    .map((el) => {
      const id = el.getAttribute("data-slice-machine-row");
      return id ? { id, r: el.getBoundingClientRect() } : null;
    })
    .filter((x): x is { id: string; r: DOMRect } => x !== null)
    .sort((a, b) => a.r.top - b.r.top);

  for (let i = 0; i < rects.length; i++) {
    const isLast = i === rects.length - 1;
    /**
     * For all but the last element, split on the midpoint between consecutive rects.
     * For the LAST element, split on its own vertical midpoint — this creates a lower zone
     * that falls past the loop and returns null (= insert at end), enabling "move below last node."
     */
    const splitBelow = isLast
      ? (rects[i]!.r.top + rects[i]!.r.bottom) / 2
      : (rects[i]!.r.bottom + rects[i + 1]!.r.top) / 2;
    if (clientY < splitBelow) {
      const id = rects[i]!.id;
      if (id === activeId) {
        if (i < rects.length - 1) return rects[i + 1]!.id;
        return null;
      }
      return id;
    }
  }
  return null;
}

/**
 * Rows in `columnEl` that belong to `orderedChildIds`, top-sorted. Uses querySelectorAll + id filter so
 * we never rely on CSS attribute escaping for node ids (fixes 0 hits when per-id selectors fail).
 */
function collectParentChildRowRectsInColumn(
  columnEl: Element,
  orderedChildIds: string[]
): { id: string; r: DOMRect }[] {
  const allow = new Set(orderedChildIds);
  const all = [...columnEl.querySelectorAll("[data-slice-machine-row]")] as HTMLElement[];
  const rects: { id: string; r: DOMRect }[] = [];
  for (const el of all) {
    const id = el.getAttribute("data-slice-machine-row");
    if (!id || !allow.has(id)) continue;
    rects.push({ id, r: el.getBoundingClientRect() });
  }
  rects.sort((a, b) => a.r.top - b.r.top);
  return rects;
}

/**
 * Resolve drop index using sibling ids and row rects **in one column**. While dragging cross-slice, the
 * active row still lives in the source column’s DOM, so querying `[data-slice-branch]` misses it and
 * breaks split lines — this path only uses rows that exist under the target column for each id.
 */
function computeInsertBeforeFromSiblingRows(
  columnEl: Element | null,
  siblingIds: string[],
  clientY: number,
  activeId: string
): string | null {
  if (!columnEl || siblingIds.length === 0) return null;
  const rects = collectParentChildRowRectsInColumn(columnEl, siblingIds);
  if (rects.length === 0) return null;
  for (let i = 0; i < rects.length; i++) {
    const isLast = i === rects.length - 1;
    /**
     * For all but the last element, split on the midpoint between consecutive rects.
     * For the LAST element, split on its own vertical midpoint — lower half falls past the loop
     * and returns null (= insert at end), enabling "move below last node."
     */
    const splitBelow = isLast
      ? (rects[i]!.r.top + rects[i]!.r.bottom) / 2
      : (rects[i]!.r.bottom + rects[i + 1]!.r.top) / 2;
    if (clientY < splitBelow) {
      const id = rects[i]!.id;
      if (id === activeId) {
        if (i < rects.length - 1) return rects[i + 1]!.id;
        return null;
      }
      return id;
    }
  }
  return null;
}

/** Viewport-fixed rect for the dashed “drop here” slot (same slice or cross-slice target branch). */
function getMachineRowSlotRect(
  branchOrColumn: HTMLElement,
  insertBeforeId: string | null,
  activeId: string,
  rowHeightFallback: number,
  siblingIds?: string[]
): SliceInsertSlotRect | null {
  const rows =
    siblingIds != null && siblingIds.length > 0
      ? (() => {
          const allow = new Set(siblingIds);
          return [...branchOrColumn.querySelectorAll("[data-slice-machine-row]")].filter(
            (el): el is HTMLElement =>
              el instanceof HTMLElement && allow.has(el.getAttribute("data-slice-machine-row") ?? "")
          );
        })()
      : ([...branchOrColumn.querySelectorAll("[data-slice-machine-row]")] as HTMLElement[]);
  const others = rows.filter((r) => r.getAttribute("data-slice-machine-row") !== activeId);
  const h = rowHeightFallback;
  if (others.length === 0) {
    return null;
  }
  const fr = others[0]!.getBoundingClientRect();
  const width = fr.width;
  const left = fr.left;
  /** Thin drop-line height — just enough to be visible without overlapping adjacent buttons. */
  const lineH = 6;
  if (insertBeforeId === null) {
    const last = others[others.length - 1]!.getBoundingClientRect();
    return { top: last.bottom + 6, left, width, height: lineH };
  }
  const targetIdx = others.findIndex((r) => r.getAttribute("data-slice-machine-row") === insertBeforeId);
  if (targetIdx < 0) return null;
  if (targetIdx === 0) {
    // Before the first visible card — place line just above it.
    const tr = others[0]!.getBoundingClientRect();
    return { top: tr.top - lineH - 4, left, width, height: lineH };
  }
  // Between two cards — place line just below the card above, before the "+" button.
  const prev = others[targetIdx - 1]!.getBoundingClientRect();
  return { top: prev.bottom + 4, left, width, height: lineH };
}

/** Nearest row that owns this tree level’s slice columns (avoids matching another level’s `data-slice-column` index). */
function sliceColumnsScopeRoot(from: HTMLElement | null): ParentNode {
  return from?.closest("[data-slice-columns-scope]") ?? document;
}

/** Branch stack for `parentId` inside a slice column (stable while the float clone is over the viewport). */
function findBranchInSliceColumn(
  parentId: string | null,
  sliceIdx: number,
  scopeRoot: ParentNode = document
): HTMLElement | null {
  const pid = parentId ?? "";
  const targetCol = scopeRoot.querySelector(`[data-slice-column="${sliceIdx}"]`);
  if (!targetCol) return null;
  const found = Array.from(targetCol.querySelectorAll("[data-slice-branch]")).find((b) => {
    const attr = (b.getAttribute("data-slice-parent-id") ?? "").trim();
    return attr === pid.trim();
  });
  return found instanceof HTMLElement ? found : null;
}

type SliceBranchDragPreview = {
  activeId: string;
  insertBeforeId: string | null;
  /** One “row” height — dragged wrapper’s offsetHeight when drag arms */
  rowShiftPx: number;
};

const SliceBranchReorderContext = createContext<{
  siblingIds: string[];
  preview: SliceBranchDragPreview | null;
  setPreview: (p: SliceBranchDragPreview | null) => void;
} | null>(null);

/** Target index of the active id after a drop (in the list with active removed, then inserted). */
function targetSlotIndex(siblingIds: string[], activeId: string, insertBeforeId: string | null): number {
  const rest = siblingIds.filter((id) => id !== activeId);
  let to = insertBeforeId === null ? rest.length : rest.indexOf(insertBeforeId);
  if (to < 0) to = rest.length;
  return to;
}

/** Vertical shift for the sibling at `index` so others make room for the dragged item. */
function siblingShiftPx(
  index: number,
  siblingIds: string[],
  preview: SliceBranchDragPreview | null
): number {
  if (!preview) return 0;
  const { activeId, insertBeforeId, rowShiftPx } = preview;
  const from = siblingIds.indexOf(activeId);
  if (from < 0 || siblingIds[index] === activeId) return 0;
  const to = targetSlotIndex(siblingIds, activeId, insertBeforeId);
  if (from < to) {
    if (index > from && index <= to) return -rowShiftPx;
  } else if (from > to) {
    if (index >= to && index < from) return rowShiftPx;
  }
  return 0;
}

export function SliceBranchReorderGroup({
  siblingIds,
  parentIdAttr,
  children,
}: {
  siblingIds: string[];
  /** Matches `data-slice-parent-id` for cross-slice drop targeting (empty string = root bucket). */
  parentIdAttr: string;
  children: ReactNode;
}) {
  const [preview, setPreview] = useState<SliceBranchDragPreview | null>(null);
  const value = useMemo(() => ({ siblingIds, preview, setPreview }), [siblingIds, preview]);
  return (
    <SliceBranchReorderContext.Provider value={value}>
      <div
        className="flex flex-col items-center gap-0"
        data-slice-branch=""
        data-slice-parent-id={parentIdAttr}
      >
        {children}
      </div>
    </SliceBranchReorderContext.Provider>
  );
}

/** Applies the same vertical shift as the machine row at `siblingIndex` (for merge/+ row above that node). */
export function SliceBranchShiftedChrome({
  siblingIndex,
  className,
  children,
}: {
  siblingIndex: number;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(SliceBranchReorderContext);
  const shiftPx =
    ctx?.preview != null ? siblingShiftPx(siblingIndex, ctx.siblingIds, ctx.preview) : 0;
  const style: CSSProperties =
    shiftPx !== 0 || ctx?.preview
      ? {
          transform: `translateY(${shiftPx}px)`,
          transition: ctx?.preview ? "none" : "transform 0.2s ease-out",
        }
      : {};
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

/** Long-press then drag: reorder within branch, or move to another slice column (horizontal drag + drop). */
export function HorizontalSliceMachineReorder({
  disabled,
  parentId,
  nodeId,
  siblingIndex,
  sliceIdx,
  children,
  onReorderComplete,
  onMoveDisplaySlice,
  /** Full `parent.children` order (tree sibling order). Used for cross-slice drop hit-testing in the target column. */
  parentOrderedChildIds,
  /** All node ids in the current column, in display order. Used for same-column vertical reorder hit-testing. */
  columnNodeIds,
}: {
  disabled: boolean;
  parentId: string | null;
  nodeId: string;
  siblingIndex: number;
  /** Current horizontal slice column index (for cross-slice moves). */
  sliceIdx: number;
  /** All child ids under this row's parent, in tree order (not limited to this slice column). */
  parentOrderedChildIds: string[];
  /** All node ids currently in this column, in display order. Used for column-wide vertical reorder. */
  columnNodeIds: string[];
  children: ReactNode;
  onReorderComplete: (insertBeforeId: string | null) => void;
  /** When drop target column differs from `sliceIdx`, updates display slice + sibling order. */
  onMoveDisplaySlice?: (targetSliceIdx: number, insertBeforeId: string | null) => void;
}) {
  const reorderCtx = useContext(SliceBranchReorderContext);
  /** Stable identity from parent useState — safe to close over in timeouts / reset */
  const setBranchPreview = reorderCtx?.setPreview;
  const parentChildIdsRef = useRef<string[]>([]);
  parentChildIdsRef.current = parentOrderedChildIds;
  const columnNodeIdsRef = useRef<string[]>([]);
  columnNodeIdsRef.current = columnNodeIds;
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressArmedRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const downRef = useRef({ x: 0, y: 0 });
  const armStartXRef = useRef(0);
  const armStartYRef = useRef(0);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  /** Sync-updated on pointermove when hit-test resolves a column (avoids stale React highlight; survives portal hit-test gaps). */
  const lastResolvedColumnIdxRef = useRef(sliceIdx);
  /** Last frame we had a resolved column index ≠ `sliceIdx` — used when drop hit-test fails (e.g. float) but user was over another slice. */
  const lastNonHomeColumnRef = useRef<number | null>(null);
  /** `useRef(initial)` only runs once — after cross-slice moves, `sliceIdx` changes but the ref must match the new column. */
  useLayoutEffect(() => {
    lastResolvedColumnIdxRef.current = sliceIdx;
  }, [sliceIdx]);
  const rowShiftPxRef = useRef(120);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [phase, setPhase] = useState<"idle" | "pending" | "dragging">("idle");
  const [floatBox, setFloatBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const sliceDragCtx = useSliceDragColumn();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    const wrap = wrapRef.current;
    if (wrap && pointerIdRef.current !== null) {
      try {
        wrap.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* not capturing */
      }
    }
    clearTimer();
    longPressArmedRef.current = false;
    draggingRef.current = false;
    pointerIdRef.current = null;
    setDragOffset({ x: 0, y: 0 });
    setFloatBox(null);
    setPhase("idle");
    setBranchPreview?.(null);
    sliceDragCtx?.setHighlightSliceIdx(null);
    sliceDragCtx?.setSliceDragActive(false);
    sliceDragCtx?.setInsertSlotRect(null);
    lastResolvedColumnIdxRef.current = sliceIdx;
    lastNonHomeColumnRef.current = null;
  }, [clearTimer, setBranchPreview, sliceDragCtx, sliceIdx]);

  const finishDrag = useCallback(() => {
      if (!longPressArmedRef.current || !draggingRef.current || !parentId) {
        sliceDragDebug("finishDrag skipped", {
          longPressArmed: longPressArmedRef.current,
          dragging: draggingRef.current,
          parentId,
          nodeId,
        });
        reset();
        return;
      }
      const wrap = wrapRef.current;
      /** Last move position — matches preview; float clone can steal hit-test if coords come only from pointerup. */
      const cx = lastXRef.current;
      const cy = lastYRef.current;
      const el = document.elementFromPoint(cx, cy);
      const colEl = el?.closest("[data-slice-column]");
      const hitSliceAttr = colEl?.getAttribute("data-slice-column");
      const hitSliceIdx =
        hitSliceAttr != null && hitSliceAttr !== ""
          ? parseInt(hitSliceAttr, 10)
          : NaN;

      /**
       * Cross-slice only when hit-test names another column, or hit-test failed but pointermove had
       * moved over another slice (`lastNonHomeColumnRef`).
       */
      let crossSliceTargetIdx: number | null = null;
      if (onMoveDisplaySlice) {
        if (!Number.isNaN(hitSliceIdx)) {
          if (hitSliceIdx !== sliceIdx) crossSliceTargetIdx = hitSliceIdx;
        } else if (lastNonHomeColumnRef.current != null) {
          const wrapEl = wrapRef.current;
          const inferredCol = wrapEl?.closest("[data-slice-column]");
          const inferredAttr = inferredCol?.getAttribute("data-slice-column");
          let inferredIdx = NaN;
          if (inferredAttr != null && inferredAttr !== "") {
            inferredIdx = parseInt(inferredAttr, 10);
          }
          if (Number.isNaN(inferredIdx) || inferredIdx !== sliceIdx) {
            crossSliceTargetIdx = lastNonHomeColumnRef.current;
          }
        }
      }

      sliceDragDebug("finishDrag", {
        nodeId,
        parentId,
        homeSliceIdx: sliceIdx,
        pointer: { cx, cy },
        hitSliceIdx,
        lastNonHomeColumn: lastNonHomeColumnRef.current,
        crossSliceTargetIdx,
        path: crossSliceTargetIdx != null ? "cross-slice" : "in-slice-reorder",
      });

      if (onMoveDisplaySlice && crossSliceTargetIdx !== null) {
        const scopeRoot = sliceColumnsScopeRoot(wrapRef.current);
        const targetCol = scopeRoot.querySelector(`[data-slice-column="${crossSliceTargetIdx}"]`);
        const pid = parentId ?? "";
        const targetBranchEl = targetCol
          ? Array.from(targetCol.querySelectorAll("[data-slice-branch]")).find((b) => {
              const attr = (b.getAttribute("data-slice-parent-id") ?? "").trim();
              return attr === pid.trim();
            })
          : undefined;
        const pids = parentChildIdsRef.current;
        let insertBefore: string | null = null;
        if (pids.length > 0 && targetCol) {
          insertBefore = computeInsertBeforeFromSiblingRows(targetCol, pids, cy, nodeId);
        }
        if (insertBefore === null && targetBranchEl instanceof HTMLElement) {
          insertBefore = computeInsertBeforeFromPointer(targetBranchEl, cy, nodeId);
        }
        const rowRectsInTarget =
          targetCol instanceof Element && pids.length > 0
            ? collectParentChildRowRectsInColumn(targetCol, pids)
            : [];
        sliceDragDebug("onMoveDisplaySlice", {
          crossSliceTargetIdx,
          insertBefore,
          targetBranchFound: !!targetBranchEl,
          parentChildRowRectsInTargetCol: rowRectsInTarget.length,
          ...(rowRectsInTarget.length === 0 && targetCol instanceof Element
            ? {
                columnMachineRowIds: [...targetCol.querySelectorAll("[data-slice-machine-row]")].map(
                  (el) => el.getAttribute("data-slice-machine-row")
                ),
                expectedParentChildIds: pids,
                hint:
                  "Slice columns are global: this column can show other parents’ machines before yours renders here — 0 sibling rows is normal until pin runs; targetBranchFound false means no branch group for this parent in DOM yet.",
              }
            : {}),
        });
        onMoveDisplaySlice(crossSliceTargetIdx, insertBefore);
        sliceDragCtx?.setHighlightSliceIdx(null);
        reset();
        return;
      }

      // Same slice: vertical order across all column nodes (not just same-parent siblings).
      const scopeRoot = sliceColumnsScopeRoot(wrapRef.current);
      const targetCol = scopeRoot.querySelector(`[data-slice-column="${sliceIdx}"]`);
      const colIds = columnNodeIdsRef.current;
      const pids = parentChildIdsRef.current;
      let insertBefore: string | null = null;
      // Prefer column-wide hit test so cross-group nodes resolve correctly.
      if (colIds.length > 0 && targetCol) {
        insertBefore = computeInsertBeforeFromSiblingRows(targetCol, colIds, cy, nodeId);
      }
      // Fall back to parent-group rows, then branch pointer.
      if (insertBefore === null && pids.length > 0 && targetCol) {
        insertBefore = computeInsertBeforeFromSiblingRows(targetCol, pids, cy, nodeId);
      }
      const branch =
        findBranchInSliceColumn(parentId, sliceIdx, scopeRoot) ??
        (wrap?.closest("[data-slice-branch]") as HTMLElement | null);
      if (insertBefore === null && branch instanceof HTMLElement) {
        insertBefore = computeInsertBeforeFromPointer(branch, cy, nodeId);
      }
      const canResolveReorder =
        (colIds.length > 0 && targetCol != null) || (pids.length > 0 && targetCol != null) || branch instanceof HTMLElement;
      if (canResolveReorder) {
        sliceDragDebug("onReorderComplete", {
          insertBefore,
          branch: branch instanceof HTMLElement ? "found" : "absent",
          usedColumnQuery: colIds.length > 0 && targetCol != null,
          usedParentChildColumnQuery: pids.length > 0 && targetCol != null,
        });
        onReorderComplete(insertBefore);
      } else {
        sliceDragDebug("onReorderComplete skipped — no branch element", { parentId, sliceIdx });
      }
      reset();
    },
    [nodeId, onMoveDisplaySlice, onReorderComplete, parentId, reset, sliceIdx]
  );

  useEffect(() => {
    const onBlur = () => reset();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [reset]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !parentId || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, select, textarea, [role='slider'], [data-no-slice-drag]")) return;

    reset();
    clearTimer();
    downRef.current = { x: e.clientX, y: e.clientY };
    lastXRef.current = e.clientX;
    lastYRef.current = e.clientY;
    pointerIdRef.current = e.pointerId;
    setPhase("pending");

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressArmedRef.current = true;
      draggingRef.current = true;
      armStartXRef.current = lastXRef.current;
      armStartYRef.current = lastYRef.current;
      const wrapEl = wrapRef.current;
      const rowEl = wrapEl?.querySelector("[data-slice-machine-row]");
      const hRaw =
        rowEl instanceof HTMLElement ? rowEl.offsetHeight : wrapEl?.offsetHeight ?? 120;
      /** Outer wrapper can include belts + chrome; slot + shift preview should match one machine row height. */
      const h = Math.min(Math.max(hRaw, 72), 220);
      rowShiftPxRef.current = h;
      const r = wrapEl?.getBoundingClientRect();
      if (r) {
        setFloatBox({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
      sliceDragCtx?.setSliceDragActive(true);
      setPhase("dragging");
      lastResolvedColumnIdxRef.current = sliceIdx;
      lastNonHomeColumnRef.current = null;
      sliceDragDebug("long-press armed (drag start)", { nodeId, parentId, sliceIdx });
      wrapRef.current?.setPointerCapture(e.pointerId);
      const scopeForArm = sliceColumnsScopeRoot(wrapRef.current);
      const armCol = scopeForArm.querySelector(`[data-slice-column="${sliceIdx}"]`);
      const branchAtArm =
        parentId != null
          ? findBranchInSliceColumn(parentId, sliceIdx, scopeForArm) ?? wrapRef.current?.closest("[data-slice-branch]")
          : wrapRef.current?.closest("[data-slice-branch]");
      const pidsArm = parentChildIdsRef.current;
      let insertArm: string | null = null;
      if (pidsArm.length > 0 && armCol instanceof HTMLElement) {
        insertArm = computeInsertBeforeFromSiblingRows(armCol, pidsArm, lastYRef.current, nodeId);
      }
      if (insertArm === null && branchAtArm instanceof HTMLElement) {
        insertArm = computeInsertBeforeFromPointer(branchAtArm, lastYRef.current, nodeId);
      }
      const slotHostArm =
        armCol instanceof HTMLElement ? armCol : branchAtArm instanceof HTMLElement ? branchAtArm : null;
      if (setBranchPreview && slotHostArm) {
        setBranchPreview({
          activeId: nodeId,
          insertBeforeId: insertArm,
          rowShiftPx: h,
        });
        const slot = getMachineRowSlotRect(
          slotHostArm,
          insertArm,
          nodeId,
          h,
          pidsArm.length > 0 ? pidsArm : undefined
        );
        if (slot) sliceDragCtx?.setInsertSlotRect(slot);
      }
      setDragOffset({ x: 0, y: 0 });
    }, SLICE_REORDER_LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    lastXRef.current = e.clientX;
    lastYRef.current = e.clientY;
    if (timerRef.current !== null && !longPressArmedRef.current) {
      const dx = e.clientX - downRef.current.x;
      const dy = e.clientY - downRef.current.y;
      if (Math.hypot(dx, dy) > SLICE_REORDER_MOVE_CANCEL_PX) {
        clearTimer();
        setPhase("idle");
      }
      return;
    }
    if (longPressArmedRef.current && draggingRef.current) {
      e.preventDefault();
      const ox = e.clientX - armStartXRef.current;
      const oy = e.clientY - armStartYRef.current;
      setDragOffset({ x: ox, y: oy });

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const colEl = el?.closest("[data-slice-column]");
      const targetSliceAttr = colEl?.getAttribute("data-slice-column");
      const targetSliceIdx =
        targetSliceAttr != null && targetSliceAttr !== ""
          ? parseInt(targetSliceAttr, 10)
          : NaN;
      if (!Number.isNaN(targetSliceIdx)) {
        lastResolvedColumnIdxRef.current = targetSliceIdx;
        lastNonHomeColumnRef.current = targetSliceIdx !== sliceIdx ? targetSliceIdx : null;
      } else {
        const wrapEl = wrapRef.current;
        const inferredCol = wrapEl?.closest("[data-slice-column]");
        const inferredAttr = inferredCol?.getAttribute("data-slice-column");
        if (inferredAttr != null && inferredAttr !== "") {
          const inferredIdx = parseInt(inferredAttr, 10);
          if (!Number.isNaN(inferredIdx) && inferredIdx === sliceIdx) {
            lastNonHomeColumnRef.current = null;
          }
        }
      }

      const resolvedForHighlight = !Number.isNaN(targetSliceIdx) ? targetSliceIdx : lastResolvedColumnIdxRef.current;

      if (onMoveDisplaySlice && sliceDragCtx && !Number.isNaN(resolvedForHighlight)) {
        sliceDragCtx.setHighlightSliceIdx(resolvedForHighlight !== sliceIdx ? resolvedForHighlight : null);
      }

      const wrap = wrapRef.current;
      const scopeMove = sliceColumnsScopeRoot(wrap);
      const overOtherSlice =
        onMoveDisplaySlice && !Number.isNaN(resolvedForHighlight) && resolvedForHighlight !== sliceIdx;

      const branchForPreview =
        parentId != null
          ? findBranchInSliceColumn(parentId, sliceIdx, scopeMove) ?? wrap?.closest("[data-slice-branch]")
          : wrap?.closest("[data-slice-branch]");

      const rowH = rowShiftPxRef.current;
      const pidsMove = parentChildIdsRef.current;
      const colIdsMove = columnNodeIdsRef.current;

      if (branchForPreview instanceof HTMLElement && setBranchPreview) {
        if (overOtherSlice) {
          setBranchPreview(null);
        } else {
          const homeCol = scopeMove.querySelector(`[data-slice-column="${sliceIdx}"]`);
          // Use column-wide ids for insert preview so cross-group positions resolve correctly.
          let insertBefore = null as string | null;
          if (colIdsMove.length > 0 && homeCol instanceof HTMLElement) {
            insertBefore = computeInsertBeforeFromSiblingRows(homeCol, colIdsMove, e.clientY, nodeId);
          }
          if (insertBefore === null && pidsMove.length > 0 && homeCol instanceof HTMLElement) {
            insertBefore = computeInsertBeforeFromSiblingRows(homeCol, pidsMove, e.clientY, nodeId);
          }
          if (insertBefore === null) {
            insertBefore = computeInsertBeforeFromPointer(branchForPreview, e.clientY, nodeId);
          }
          setBranchPreview({
            activeId: nodeId,
            insertBeforeId: insertBefore,
            rowShiftPx: rowH,
          });
        }
      }

      if (sliceDragCtx && parentId) {
        if (overOtherSlice) {
          // For cross-slice moves the column highlight (amber ring) is sufficient —
          // skip the insert-slot rect to avoid it appearing above the target column when
          // `tr.top - rowHeight` goes off-screen.
          sliceDragCtx.setInsertSlotRect(null);
        } else if (branchForPreview instanceof HTMLElement) {
          const homeCol = scopeMove.querySelector(`[data-slice-column="${sliceIdx}"]`);
          // Use column-wide ids for slot rect so cross-group insert positions are found correctly.
          let insertBefore: string | null = null;
          if (colIdsMove.length > 0 && homeCol instanceof HTMLElement) {
            insertBefore = computeInsertBeforeFromSiblingRows(homeCol, colIdsMove, e.clientY, nodeId);
          }
          if (insertBefore === null && pidsMove.length > 0 && homeCol instanceof HTMLElement) {
            insertBefore = computeInsertBeforeFromSiblingRows(homeCol, pidsMove, e.clientY, nodeId);
          }
          if (insertBefore === null) {
            insertBefore = computeInsertBeforeFromPointer(branchForPreview, e.clientY, nodeId);
          }
          // Suppress the slot when the resolved position is already the node's current position
          // (i.e. the drop would be a no-op). This avoids a ghost slot appearing over the active node.
          const activeIdx = colIdsMove.indexOf(nodeId);
          const isNoop =
            (insertBefore === null && activeIdx === colIdsMove.length - 1) ||
            (insertBefore !== null && activeIdx >= 0 && colIdsMove[activeIdx + 1] === insertBefore);
          if (isNoop) {
            sliceDragCtx.setInsertSlotRect(null);
          } else {
            const slotHostIn =
              homeCol instanceof HTMLElement ? homeCol : branchForPreview;
            const slot = getMachineRowSlotRect(
              slotHostIn,
              insertBefore,
              nodeId,
              rowH,
              colIdsMove.length > 0 ? colIdsMove : pidsMove.length > 0 ? pidsMove : undefined
            );
            sliceDragCtx.setInsertSlotRect(slot);
          }
        }
      }
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!longPressArmedRef.current) {
      clearTimer();
      reset();
      return;
    }
    if (draggingRef.current) {
      lastXRef.current = e.clientX;
      lastYRef.current = e.clientY;
      finishDrag();
      return;
    }
    reset();
  };

  const onPointerCancel = () => {
    reset();
  };

  const isDragging = phase === "dragging";
  const siblingShift =
    reorderCtx?.preview != null
      ? siblingShiftPx(siblingIndex, reorderCtx.siblingIds, reorderCtx.preview)
      : 0;
  /** In-flow row: preview shifts only; while dragging, float clone is portaled — no translate here. */
  const translateY = isDragging ? siblingShift : siblingShift + dragOffset.y;
  const wrapperStyle: CSSProperties | undefined = isDragging
    ? {
        opacity: 0,
        pointerEvents: "none",
      }
    : translateY !== 0 || reorderCtx?.preview
      ? {
          transform: `translateY(${translateY}px)`,
          transition: reorderCtx?.preview ? "none" : "transform 0.2s ease-out",
        }
      : undefined;

  const showFloatLayer = isDragging && floatBox != null;

  return (
    <>
      <div
        ref={wrapRef}
        className={
          isDragging
            ? "relative cursor-grabbing touch-none select-none"
            : "relative touch-manipulation select-none"
        }
        style={wrapperStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {children}
      </div>
      {showFloatLayer &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none cursor-grabbing opacity-[0.98] shadow-2xl shadow-black/50 **:pointer-events-none"
            style={{
              position: "fixed",
              left: floatBox.left + dragOffset.x,
              top: floatBox.top + dragOffset.y,
              width: floatBox.width,
              zIndex: 10000,
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
