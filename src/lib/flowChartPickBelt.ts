import type { KeyName } from "@/lib/types";
import {
  pickDefaultTransportForItem,
  pickTransportAtLeastPreferred,
} from "@/lib/flowTransport";

export function pickDefaultBelt(throughput: number, itemKey?: KeyName): string {
  return pickDefaultTransportForItem(itemKey ?? "iron-ore", throughput);
}

/** Smallest belt tier ≥ preferred Mk that still carries `throughputNeeded` (otherwise max of those tiers). */
export function pickBeltAtLeastPreferred(
  throughputNeeded: number,
  preferredBeltKey: string,
  itemKey?: KeyName
): string {
  return pickTransportAtLeastPreferred(itemKey ?? "iron-ore", throughputNeeded, preferredBeltKey);
}
