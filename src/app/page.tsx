import { FlowChart } from "@/components/FlowChart";

export default function Home() {
  return (
    <div className="flex h-screen w-full min-w-full flex-col overflow-hidden bg-[#0c0c0c] text-zinc-100">
      <FlowChart />
    </div>
  );
}
