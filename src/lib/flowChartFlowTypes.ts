import type { KeyName } from "@/lib/types";

export type FlowInputData = {
  itemKey: KeyName;
  itemName: string;
  needsInput: number;
  receivesInput: number;
};

export type FlowOutputData = {
  itemKey: KeyName;
  itemName: string;
  maxOutput: number;
  currentOutput: number;
  isPrimary: boolean;
};

export type FlowRateData = {
  /** What the parent is sending (total) - for display on connection */
  parentSending: number;
  /** Belt capacity for this connection (items/min) */
  beltCapacity: number;
  /** What this machine needs (recipe input/min × count × clock%) - legacy single-input */
  needsInput: number;
  /** What this machine actually receives (belt-limited, supply-limited) - legacy */
  receivesInput: number;
  /** Per-input breakdown for multi-input machines */
  inputs?: FlowInputData[];
  /** Max output if 100% fed */
  maxOutput: number;
  /** Actual output based on input utilization */
  currentOutput: number;
  /** Per-output breakdown for multi-output recipes (includes primary output) */
  outputs?: FlowOutputData[];
  /** 0-1, how well fed */
  utilization: number;
};
