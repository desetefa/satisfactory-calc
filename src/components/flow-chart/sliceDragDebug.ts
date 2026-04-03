/**
 * Opt-in debug for horizontal slice drag / reorder. Enable either:
 * - `localStorage.setItem("DEBUG_SLICE_DRAG", "1")` then reload, or
 * - `?debugSliceDrag=1` or `?debugSliceDrag=true` on the URL (presence alone also works)
 *
 * Uses `console.log` (not `console.debug`) so messages show with default DevTools levels.
 */

function urlDebugOn(): boolean {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  if (params.has("debugSliceDrag") && !params.get("debugSliceDrag")) return true;
  const v = params.get("debugSliceDrag");
  return v === "1" || v === "true" || v === "yes";
}

function localStorageDebugOn(): boolean {
  try {
    const v = window.localStorage.getItem("DEBUG_SLICE_DRAG");
    return v === "1" || v === "true" || v === "yes";
  } catch {
    return false;
  }
}

export function isSliceDragDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return urlDebugOn() || localStorageDebugOn();
  } catch {
    return false;
  }
}

let loggedBanner = false;

export function sliceDragDebug(...args: unknown[]): void {
  if (!isSliceDragDebugEnabled()) return;
  if (!loggedBanner) {
    loggedBanner = true;
    console.log(
      "[slice-drag] Debug ON — slice layout logs on tree change; drag logs on long-press / drop. Disable: localStorage.removeItem('DEBUG_SLICE_DRAG') or drop ?debugSliceDrag from URL."
    );
  }
  console.log("[slice-drag]", ...args);
}
