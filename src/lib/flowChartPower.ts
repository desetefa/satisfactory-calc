import { getBuilding, getMiner } from "@/lib/db";
import type { FlowRateData } from "@/lib/flowChartFlowTypes";
import { getTotalClockFraction, type FlowNode } from "@/lib/flowChartModel";

export type NodePowerDisplay = {
  isGenerating: boolean;
  mw: number;
};

export function getNodePowerDisplay(
  node: FlowNode,
  flowData?: FlowRateData | { parentSending: number }
): NodePowerDisplay | null {
  const generatedPowerMw =
    node.outputItemKey === "power"
      ? flowData && "currentOutput" in flowData
        ? flowData.currentOutput
        : node.totalOutput
      : 0;
  const consumedPowerMw =
    node.outputItemKey === "power"
      ? 0
      : ((getBuilding(node.buildingKey)?.power ?? getMiner(node.buildingKey)?.power ?? 0) *
          getTotalClockFraction(node));
  if (generatedPowerMw <= 0.01 && consumedPowerMw <= 0.01) return null;
  const isGenerating = generatedPowerMw >= consumedPowerMw;
  return {
    isGenerating,
    mw: isGenerating ? generatedPowerMw : consumedPowerMw,
  };
}

