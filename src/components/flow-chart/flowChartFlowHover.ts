/** CSS classes for flow diagram hover/pin highlight on node cards */
export function flowHoverHighlightClass(flowHighlightSelf: boolean, flowHighlightRelated: boolean): string {
  if (flowHighlightSelf) {
    return "ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950 z-[5]";
  }
  if (flowHighlightRelated) {
    return "ring-2 ring-sky-500/70 ring-offset-2 ring-offset-zinc-950 bg-sky-950/25 z-[1]";
  }
  return "";
}
