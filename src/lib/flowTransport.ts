import { getAllBelts, getAllPipes, getBelt, getFluid, getPipe } from "@/lib/db";
import type { KeyName } from "@/lib/types";

export type FlowTransportOption = {
  key_name: string;
  name: string;
  rate: number;
  kind: "belt" | "pipe";
};

const SORT_ASC_RATE = (a: { rate: number }, b: { rate: number }) => a.rate - b.rate;

const BELTS: FlowTransportOption[] = getAllBelts()
  .sort(SORT_ASC_RATE)
  .map((b) => ({ ...b, kind: "belt" as const }));

const PIPES: FlowTransportOption[] = getAllPipes()
  .sort(SORT_ASC_RATE)
  .map((p) => ({ ...p, kind: "pipe" as const }));

export function isFluidItem(itemKey?: KeyName | null): boolean {
  return !!itemKey && !!getFluid(itemKey);
}

export function getTransportOptionsForItem(itemKey?: KeyName | null): FlowTransportOption[] {
  return isFluidItem(itemKey) ? PIPES : BELTS;
}

function defaultTransportKeyForItem(itemKey?: KeyName | null): string {
  const opts = getTransportOptionsForItem(itemKey);
  return opts[0]?.key_name ?? (isFluidItem(itemKey) ? "pipe1" : "belt1");
}

export function getTransportRateForItem(itemKey: KeyName, transportKey?: string): number {
  const opts = getTransportOptionsForItem(itemKey);
  if (opts.length === 0) return 0;
  if (!transportKey) return opts[0]!.rate;
  const transport = isFluidItem(itemKey) ? getPipe(transportKey) : getBelt(transportKey);
  return transport?.rate ?? opts[0]!.rate;
}

export function pickDefaultTransportForItem(itemKey: KeyName, throughput: number): string {
  const opts = getTransportOptionsForItem(itemKey);
  if (opts.length === 0) return defaultTransportKeyForItem(itemKey);
  const match = opts.find((t) => t.rate >= throughput);
  return match?.key_name ?? opts[opts.length - 1]!.key_name;
}

/** For solids: honor preferred belt tier. For fluids: pick minimal matching pipe tier. */
export function pickTransportAtLeastPreferred(
  itemKey: KeyName,
  throughputNeeded: number,
  preferredBeltKey: string
): string {
  if (isFluidItem(itemKey)) {
    return pickDefaultTransportForItem(itemKey, throughputNeeded);
  }
  const prefRate = getBelt(preferredBeltKey)?.rate ?? 60;
  const belts = BELTS.filter((b) => b.rate >= prefRate);
  if (belts.length === 0) return preferredBeltKey;
  const ok = belts.find((b) => b.rate >= throughputNeeded);
  return ok?.key_name ?? belts[belts.length - 1]!.key_name;
}

export function normalizeTransportForItem(itemKey: KeyName, transportKey?: string): string {
  const opts = getTransportOptionsForItem(itemKey);
  if (opts.length === 0) return transportKey ?? defaultTransportKeyForItem(itemKey);
  if (!transportKey) return opts[0]!.key_name;
  const valid = opts.some((t) => t.key_name === transportKey);
  return valid ? transportKey : opts[0]!.key_name;
}
