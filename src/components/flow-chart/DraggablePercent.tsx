"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

/** Drag left/right to adjust value (1–250). Uses pointer capture so drag continues outside the element. */
export function DraggablePercent({
  value,
  onChange,
  min = 1,
  max = 250,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
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

  return (
    <span
      role="slider"
      tabIndex={0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`cursor-ew-resize select-none touch-none ${className}`}
      onPointerDown={handlePointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(Math.max(min, value - step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(Math.min(max, value + step));
        }
      }}
    >
      {value}%
    </span>
  );
}
