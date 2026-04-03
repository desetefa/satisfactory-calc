import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import type { FlowNode } from "@/lib/flowChartModel";
import type { BuildInventoryRow } from "@/lib/flowChartBuildInventory";
import type { KeyName } from "@/lib/types";

export type MachineOption = {
  recipeKey: string;
  recipeName: string;
  buildingKey: string;
  buildingName: string;
  outputItemKey: KeyName;
  outputPerMachine: number;
  inputPerMachine: number;
};

export interface AddMachineModalProps {
  title: string;
  /** Recommended options — machines/products that match the current available inputs. */
  options: MachineOption[];
  /** Full option set (all machines). When provided, options shown as "Recommended" and the
   *  remainder of allOptions shown as "Other". */
  allOptions?: MachineOption[];
  onSelect: (opt: MachineOption) => void;
  onClose: () => void;
}

export interface SaveAsModalProps {
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export interface BuildInventoryModalProps {
  factoryName: string;
  factoryRows: BuildInventoryRow[];
  factoryPowerShards: number;
  workspaceRows: BuildInventoryRow[];
  workspacePowerShards: number;
  onClose: () => void;
}

export interface EditNodeModalProps {
  node: FlowNode;
  machineOptions: MachineOption[];
  producesOptions: MachineOption[];
  onUpdate: (u: Partial<FlowNode>) => void;
  onSelectMachine: (opt: MachineOption) => void;
  onClose: () => void;
  onRemove?: () => void;
  /** Flow simulation row for this node (optional). */
  flowData?: FlowRateData | { parentSending: number };
  /** Total downstream demand for this machine’s output (items/min). */
  totalDemand?: number;
  /** Number of machines fed downstream. */
  childCount?: number;
  /** Belt from parent into this machine (when applicable). */
  incomingBeltKey?: string;
}
