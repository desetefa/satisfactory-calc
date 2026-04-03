"use client";

export function BranchingConnector({
  branchCount,
  className = "",
}: {
  branchCount: number;
  className?: string;
}) {
  if (branchCount <= 0) return null;
  if (branchCount === 1) {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <div className="h-4 w-px bg-zinc-600" />
        <svg className="h-6 w-6 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`flex w-full flex-col items-center ${className}`}>
      <div className="h-4 w-px bg-zinc-600" />
      <div className="h-px w-full max-w-[min(100%,400px)] bg-zinc-600" style={{ width: "calc(100% - 2rem)" }} />
      <div className="flex w-full max-w-[min(100%,400px)] justify-around" style={{ width: "calc(100% - 2rem)" }}>
        {Array.from({ length: branchCount }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="h-4 w-px bg-zinc-600" />
            <svg className="h-5 w-5 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BranchingConnectorHorizontal({ className = "" }: { className?: string }) {
  return (
    <div className={`flex shrink-0 flex-row items-center gap-0 ${className}`}>
      <div className="h-px w-3 bg-zinc-600" />
      <svg className="h-4 w-4 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H3" />
      </svg>
    </div>
  );
}

export function HorizontalMultiBranchConnector({ childCount }: { childCount: number }) {
  if (childCount <= 0) return null;
  return (
    <div className="flex shrink-0 flex-row">
      <div className="flex flex-col justify-around py-1">
        {Array.from({ length: childCount }).map((_, i) => (
          <div key={i} className="flex items-center">
            <div className="h-px w-2 bg-zinc-600" />
            <svg className="h-3 w-3 shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H3" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
