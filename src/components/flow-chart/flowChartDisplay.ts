import {
  abbreviateItemDisplayName,
  getItemDisplayName,
  type ItemDisplayDensity,
} from "@/lib/itemDisplayName";
import { getBuilding } from "@/lib/db";

export function getItemName(key: string, density: ItemDisplayDensity = "comfortable"): string {
  return getItemDisplayName(key, density);
}

/** Format rate for display - shows decimals when needed (e.g. 37.5, 60) */
export function formatRate(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

export function getInputSlots(buildingKey: string): number {
  return getBuilding(buildingKey)?.max ?? 0;
}

export { abbreviateItemDisplayName };
