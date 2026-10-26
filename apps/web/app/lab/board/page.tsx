"use client";

import { useCallback, useState } from "react";
import { BoardExplorer } from "@/features/board-explorer";
import { REGIONS, type RegionStatus } from "@/lib/regions";

const DEMO_STATUSES: Record<string, RegionStatus> = {
  "REGION-A": "critical",
  "REGION-B": "attention",
  "REGION-C": "complete",
};

/** Isolated harness for the 3D board explorer: http://localhost:3000/lab/board */
export default function BoardLab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [settled, setSettled] = useState<string>("—");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, RegionStatus>>(DEMO_STATUSES);

  const onSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const onFocusSettled = useCallback((id: string | null) => setSettled(id ?? "overview"), []);

  return (
    <main className="fixed inset-0 flex flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2" data-testid="lab-toolbar">
        <span className="label">Lab · board explorer</span>
        <span className="mono text-[11px] text-muted" data-testid="lab-state">
          selected={selectedId ?? "none"} focus={focusId ?? "none"} settled={settled}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="focus-selected"
            disabled={!selectedId}
            onClick={() => {
              setSettled("…");
              setFocusId(selectedId);
            }}
            className="mono rounded-sm border border-line-strong px-2 py-1 text-[11px] disabled:opacity-40"
          >
            Focus selected
          </button>
          <button
            type="button"
            data-testid="overview"
            onClick={() => {
              setSettled("…");
              setFocusId(null);
            }}
            className="mono rounded-sm border border-line-strong px-2 py-1 text-[11px]"
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() =>
              setStatuses((s) => ({ ...s, "REGION-D": s["REGION-D"] === "complete" ? "unvisited" : "complete" }))
            }
            className="mono rounded-sm border border-line-strong px-2 py-1 text-[11px]"
          >
            Toggle D status
          </button>
          <label className="mono flex items-center gap-1 text-[11px] text-muted">
            <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
            reduced motion
          </label>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <BoardExplorer
          regions={REGIONS}
          statuses={statuses}
          selectedId={selectedId}
          focusId={focusId}
          onSelect={onSelect}
          onFocusSettled={onFocusSettled}
          reducedMotion={reducedMotion}
        />
      </div>
    </main>
  );
}
