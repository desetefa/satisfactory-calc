"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
  type CSSProperties,
  type PointerEvent,
} from "react";

const SLICE_REORDER_LONG_PRESS_MS = 400;
const SLICE_REORDER_MOVE_CANCEL_PX = 12;

function computeInsertBeforeFromPointer(branch: HTMLElement, clientY: number, activeId: string): string | null {
  const rows = [...branch.querySelectorAll("[data-slice-machine-row]")] as HTMLElement[];
  for (const row of rows) {
    const id = row.getAttribute("data-slice-machine-row");
    if (!id || id === activeId) continue;
    const r = row.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return id;
  }
  return null;
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

export function SliceBranchReorderGroup({ siblingIds, children }: { siblingIds: string[]; children: ReactNode }) {
  const [preview, setPreview] = useState<SliceBranchDragPreview | null>(null);
  const value = useMemo(() => ({ siblingIds, preview, setPreview }), [siblingIds, preview]);
  return (
    <SliceBranchReorderContext.Provider value={value}>
      <div className="flex flex-col items-center gap-2" data-slice-branch="">
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

/** Long-press then drag vertically to reorder among siblings in the same slice branch. */
export function HorizontalSliceMachineReorder({
  disabled,
  parentId,
  nodeId,
  siblingIndex,
  children,
  onReorderComplete,
}: {
  disabled: boolean;
  parentId: string | null;
  nodeId: string;
  siblingIndex: number;
  children: ReactNode;
  onReorderComplete: (insertBeforeId: string | null) => void;
}) {
  const reorderCtx = useContext(SliceBranchReorderContext);
  /** Stable identity from parent useState — safe to close over in timeouts / reset */
  const setBranchPreview = reorderCtx?.setPreview;
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressArmedRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const downRef = useRef({ x: 0, y: 0 });
  const armStartYRef = useRef(0);
  const lastYRef = useRef(0);
  const rowShiftPxRef = useRef(120);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [phase, setPhase] = useState<"idle" | "pending" | "dragging">("idle");

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
    setDragOffsetY(0);
    setPhase("idle");
    setBranchPreview?.(null);
  }, [clearTimer, setBranchPreview]);

  const finishDrag = useCallback(
    (clientY: number) => {
      const wrap = wrapRef.current;
      const branch = wrap?.closest("[data-slice-branch]");
      if (branch instanceof HTMLElement && longPressArmedRef.current && draggingRef.current && parentId) {
        const insertBefore = computeInsertBeforeFromPointer(branch, clientY, nodeId);
        onReorderComplete(insertBefore);
      }
      reset();
    },
    [nodeId, onReorderComplete, parentId, reset]
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
    lastYRef.current = e.clientY;
    pointerIdRef.current = e.pointerId;
    setPhase("pending");

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressArmedRef.current = true;
      draggingRef.current = true;
      armStartYRef.current = lastYRef.current;
      const h = wrapRef.current?.offsetHeight ?? 120;
      rowShiftPxRef.current = h;
      setPhase("dragging");
      wrapRef.current?.setPointerCapture(e.pointerId);
      const branch = wrapRef.current?.closest("[data-slice-branch]");
      if (branch instanceof HTMLElement && setBranchPreview) {
        const insertBefore = computeInsertBeforeFromPointer(branch, lastYRef.current, nodeId);
        setBranchPreview({
          activeId: nodeId,
          insertBeforeId: insertBefore,
          rowShiftPx: h,
        });
      }
    }, SLICE_REORDER_LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
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
      setDragOffsetY(e.clientY - armStartYRef.current);
      const wrap = wrapRef.current;
      const branch = wrap?.closest("[data-slice-branch]");
      if (branch instanceof HTMLElement && setBranchPreview) {
        const insertBefore = computeInsertBeforeFromPointer(branch, e.clientY, nodeId);
        setBranchPreview({
          activeId: nodeId,
          insertBeforeId: insertBefore,
          rowShiftPx: rowShiftPxRef.current,
        });
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
      finishDrag(e.clientY);
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
  const translateY = siblingShift + (isDragging ? dragOffsetY : 0);
  const wrapperStyle: CSSProperties | undefined =
    translateY !== 0 || isDragging || reorderCtx?.preview
      ? {
          transform: `translateY(${translateY}px)`,
          transition: isDragging || reorderCtx?.preview ? "none" : "transform 0.2s ease-out",
        }
      : undefined;

  return (
    <div
      ref={wrapRef}
      className={
        isDragging
          ? "relative z-20 cursor-grabbing touch-none opacity-95 shadow-lg shadow-black/40"
          : "relative touch-manipulation"
      }
      style={wrapperStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}
    </div>
  );
}
