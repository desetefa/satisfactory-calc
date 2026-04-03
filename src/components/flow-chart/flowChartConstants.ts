import { getAllBelts, getAllPipes } from "@/lib/db";

export const FLOW_CHART_BELTS = getAllBelts().sort((a, b) => a.rate - b.rate);
export const FLOW_CHART_PIPES = getAllPipes().sort((a, b) => a.rate - b.rate);
