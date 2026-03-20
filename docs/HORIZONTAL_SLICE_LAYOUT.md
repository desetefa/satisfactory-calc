# Horizontal slice layout: reorder & branch grouping

## How order works today

- **`getFlowSlices(tree)`** in `src/lib/flowChartTree.ts` builds each column by walking the tree: `nextLevel = level.flatMap((n) => n.children)`.
- Order within a slice is therefore **tree `children` order** (DFS expansion), not a separate “visual only” list.

## Rearranging nodes in a slice

### Option A — Reorder **siblings** (same parent) ✅ semantic (implemented)

- **What moves:** `parent.children` array via `reorderSiblingBefore(tree, parentId, activeId, insertBeforeId)` in `src/lib/flowChartTree.ts` (called from `FlowChart.tsx`).
- **UI:** In horizontal slice view, **long-press (~400ms)** on a machine row (same `parentId` branch, **2+ siblings**), then **drag vertically** and release. Drop index is derived from row midpoints under `data-slice-branch`. While dragging, **other siblings (and the merge/+ row above each node) translate vertically** by one row height so the stack makes room for the drop. Horizontal / cross-column reorder is not implemented yet.
- **Earlier plan:** drag handles or ↑↓ on cards — superseded by long-press + vertical drag on the slice row wrapper (`HorizontalSliceMachineReorder`).
- **Pros:** Merge/add-between logic stays correct; pool math unchanged.
- **Cons:** Only helps when machines in that slice **share one parent**. In wide graphs, one slice often mixes nodes from **different** parents.

### Option B — **Visual order** overlay (any nodes in slice)

- **Persist** e.g. `sliceOrder: Record<number, string[]>` (slice index → ordered `node.id`s) in `ChartPersistExtras` / `saveChart`.
- After `getFlowSlices`, **sort** each `sliceNodes` with: known ids first in saved order, then append unknown ids (new machines).
- **Pros:** Full reorder freedom in the column.
- **Cons:** “Insert between” and merge buttons must use **visual index** or **tree index** consistently; document which. Connectors (if any) might not match mental model.

### Option C — **Regenerate tree** from planner

- Only relevant for quick-build; not general editing.

**Recommendation:** implement **A** first (low risk). Add **B** if you need reorder across different parents.

## Vertically centered branch groups

- **Idea:** Within a slice, cluster cards by **`parentId`** (same parent = one “branch”). Render each cluster as a small vertical stack (`items-center`), then stack clusters in the column with **`justify-center`** + **`gap-*`** so multiple branches sit as **centered bands** in the middle of the slice (between INPUT header and OUTPUT footer).
- **Implementation:** see `TreeLevelSlices` — `groupSliceNodesByParent(sliceNodes)` + grouped render wrapper.
- **Tweak:** If the slice scrolls (`overflow-y-auto`), use `min-h-0 flex-1` on the scroll region and keep `justify-center` on the inner flex so short layouts stay centered; long layouts scroll from top (`justify-start`) if you prefer readability (toggle or heuristic by node count).

## Files to touch

| Change | File |
|--------|------|
| Slice derivation | `src/lib/flowChartTree.ts` — `getFlowSlices`, `groupSliceNodesByParent`, `resolveSupplierIds` |
| Grouped / centered body | `FlowChart.tsx` — `TreeLevelSlices` column body |
| Sibling reorder | `flowChartTree.ts` — `reorderSiblingBefore`; `FlowChart.tsx` — `onReorderSliceSiblings`; UI — `flow-chart/sliceBranchReorder.tsx` |
| Persist visual order | `chartStorage.ts`, `FlowChart` state, `saveChart` / `loadChart` |
