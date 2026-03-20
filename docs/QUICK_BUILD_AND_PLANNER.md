# Quick build & production planner

Reference for the **+** quick-build flow (right side of the canvas) and the backend that plans **any number of recipe inputs**.

## User-facing behavior

1. User picks **product** + **specific recipe** (and **miner tier** for mineral extractors).
2. Scope is always **one machine at 100% clock** on that recipe — **no manual items/min target**.
3. Upstream machines are sized with `ceil(demand / outputPerMachine)` so the line can feed that one machine.
4. Result is **replaced** on the canvas (with a warning if something already exists), then **`autoBalanceAfterEdit`** runs (belts + scale).

## Source files (do not duplicate logic blindly)

| Concern | File |
|--------|------|
| Modal UI (search, recipe dropdown, miner) | `src/components/QuickBuildModal.tsx` |
| Apply plan + balance + `FlowChart` state | `src/components/FlowChart.tsx` (`handleQuickBuildConfirm`, `autoBalanceAfterEdit`) |
| Pure planning (DAG, rates, cycles) | `src/lib/productionPlanner.ts` |
| `ProductionPlan` → `TreeNode` + `inputEdges` + slice-friendly parent chain | `src/lib/plannerToTree.ts` |
| Shared `TreeNode` / `FlowNode` / factories | `src/lib/flowChartModel.ts` |
| Linear legacy chain (iron plate starter, etc.) | `src/lib/chain.ts`, `buildTreeFromChain` in `FlowChart.tsx` |
| Tests | `src/lib/productionPlanner.test.ts` (`npm test` / `vitest run`) |

## Data flow

```
QuickBuildModal.onConfirm({ productKey, recipeKey, minerKey })
  → FlowChart.handleQuickBuildConfirm
      → planProductionFromTarget({ productKey, recipeKey }, { minerKey })
      → productionPlanToSliceTree(plan)
      → recalcTree(synthesizeMissingInputEdges(tree))
      → autoBalanceAfterEdit(tree, targetNodeId, preferredBeltKey)
```

- **`planProductionFromTarget`** returns `{ ok, plan }` or `{ ok: false, error }`. Show `error` in the modal.
- **Extractor-only** products use pseudo recipe keys from `getExtractorMachineOptionsFull()` (`_raw_<resource>_<building>`); the planner handles those without `getRecipe`.

## Tree layout rules (`plannerToTree`)

- **Depth** is derived from plan edges (producer → consumer); **roots** have no incoming edge.
- **Multiple raw roots**: first sorted root is the **tree root**; other roots are **direct children** of that root (matches `getFlowSlices` raw sibling pattern).
- **One tree parent** per consumer: supplier with **greatest depth** becomes the **parent** link; other suppliers use **`inputEdges`** with **`producerId` = the supplier `FlowNode.id`** (not planner group id).

## Intermediate recipes

- Default upstream recipe per item: **first non-alternate** (`pickDefaultRecipeForProduct`), same spirit as `sortOptionsNonAltFirst` in the UI.

## Known limitations / future work

- **Subtree dedupe**: identical `(itemKey, recipeKey)` subgraphs are **not** merged; each branch gets its own machines (plan “phase 2b”).
- **Optional numeric target** (N× output) is **not** in the UI; add later if needed.
- **Slice pool order** can still interact with balance; `autoBalanceAfterEdit` mitigates but edge cases may need ordering tweaks.

## Horizontal slice UI (ordering & branches)

See **`docs/HORIZONTAL_SLICE_LAYOUT.md`** for rearranging nodes in a column and branch-centric vertical layout.

## Changing behavior safely

- Prefer edits in **`productionPlanner.ts`** / **`plannerToTree.ts`** over growing **`FlowChart.tsx`**.
- After planner or tree changes, run **`npm test`** and a quick manual quick-build (e.g. Encased Industrial Beam + Iron Plate).
- Keep **`flowChartModel.ts`** as the single place for `TreeNode` shape used by storage (`chartStorage` imports `TreeNode` from here).
