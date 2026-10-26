"use client";

import { useEffect } from "react";
import { useStore, type Workspace } from "@/lib/store";
import EvidenceView from "../evidence/EvidenceView";
import Inspector from "../inspections/Inspector";
import Timeline from "../inspections/Timeline";
import SystemView from "../system/SystemView";
import VerificationView from "../verification/VerificationView";
import BoardWorkspace from "./BoardWorkspace";
import MainCanvas from "./MainCanvas";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";

const KEYS: Record<string, Workspace> = { "1": "inspect", "2": "board", "3": "verify", "4": "evidence", "5": "system" };

export default function Workstation() {
  const workspace = useStore((s) => s.workspace);
  const boot = useStore((s) => s.boot);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const s = useStore.getState();
      const k = e.key.toLowerCase();
      if (KEYS[e.key]) s.setWorkspace(KEYS[e.key]);
      else if (k === "v") s.setTool("navigate");
      else if (k === "m") s.setTool(s.tool === "measure" ? "navigate" : "measure");
      else if (k === "c") s.toggleLayer("candidates");
      else if (k === "g") s.toggleLayer("glare");
      else if (k === "t") s.toggleLayer("tiles");
      else if (k === "o") s.setShowOriginal(!s.showOriginal);
      else if (k === "b") s.setCanvasMode(s.canvasMode === "board" && s.session?.observations.length ? "microscope" : "board");
      else if (k === "escape") s.selectCandidate(null);
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid h-dvh min-h-[560px] w-full grid-cols-[minmax(0,1fr)] grid-rows-[44px_minmax(0,1fr)] overflow-hidden bg-bg">
      <TopBar />
      <main className="min-h-0 min-w-0 overflow-hidden">
        {workspace === "inspect" && (
          <div className="flex h-full min-h-0">
            <ToolRail />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1">
                <MainCanvas />
                <aside aria-label="Inspector" className="w-[352px] shrink-0 overflow-y-auto border-l border-line bg-panel max-lg:w-[300px]">
                  <Inspector />
                </aside>
              </div>
              <div className="h-[108px] min-w-0 shrink-0 overflow-hidden border-t border-line bg-surface">
                <Timeline />
              </div>
            </div>
          </div>
        )}
        {workspace === "board" && <BoardWorkspace />}
        {workspace === "verify" && <VerificationView />}
        {workspace === "evidence" && <EvidenceView />}
        {workspace === "system" && <SystemView />}
      </main>
    </div>
  );
}
