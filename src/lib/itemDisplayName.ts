/**
 * Short UI labels for tight layouts; full names when there's room.
 *
 * **compact**: `Reinforced ` → `R. `, `Modular ` → `M. `, `Encased Industrial ` → `Enc. Ind. `, `Copper Ingot` → `Cu Ingot`
 * **comfortable**: no shortening (full game names)
 */
import { getItem, getFluid } from "@/lib/db";
import type { KeyName } from "@/lib/types";

export type ItemDisplayDensity = "compact" | "comfortable";

export function abbreviateItemDisplayName(
  name: string,
  density: ItemDisplayDensity = "comfortable"
): string {
  if (!name) return name;
  if (density === "comfortable") return name;
  return name
    .replace(/Reinforced /g, "R. ")
    .replace(/Modular /g, "M. ")
    .replace(/Encased Industrial /g, "Enc. Ind. ")
    .replace(/Copper Ingot/g, "Cu Ingot");
}

export function getItemDisplayName(
  key: string,
  density: ItemDisplayDensity = "comfortable"
): string {
  if (key === "power") {
    return density === "compact" ? "Power" : "Power";
  }
  const raw = getItem(key as KeyName)?.name ?? getFluid(key as KeyName)?.name ?? key;
  return abbreviateItemDisplayName(raw, density);
}
