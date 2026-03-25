"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** Drag left/right to adjust value (1–250). Double-click to type. Uses pointer capture so drag continues outside the element. */
export function DraggablePercent({
  value,
  onChange,
  min = 1,
  max = 250,
  className = "",
  title: titleAttr,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      cancel();
      return;
    }
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n)) {
      cancel();
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    onChange(clamped);
    setEditing(false);
    setDraft(String(clamped));
  };

  const cancel = () => {
    setDraft(String(value));
    setEditing(false);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);
    const startX = e.clientX;
    /** Value at pointer down — cumulative dx avoids per-move rounding + magnetic snap feel */
    const startValue = value;
    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const next = Math.min(max, Math.max(min, Math.round(startValue + dx / 2)));
      onChange(next);
    };
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "none";
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Clock percent, ${min} to ${max}`}
        className={`box-border min-w-[2.75rem] max-w-[4.5rem] cursor-text select-text text-center outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => commit()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      role="slider"
      tabIndex={0}
      title={titleAttr ?? "Drag to adjust, double-click to type"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`cursor-ew-resize select-none touch-none ${className}`}
      onPointerDown={handlePointerDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDraft(String(value));
        setEditing(true);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(Math.max(min, value - step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(Math.min(max, value + step));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDraft(String(value));
          setEditing(true);
        }
      }}
    >
      {value}%
    </span>
  );
}
