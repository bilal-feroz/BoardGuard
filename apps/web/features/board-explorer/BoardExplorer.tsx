"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useState, type ReactNode } from "react";
import { BoardFallback } from "./BoardFallback";
import { RegionKeyboardNav } from "./RegionList";
import type { BoardExplorerProps } from "./types";
import { usePrefersReducedMotion, useWebGLSupport } from "./useWebGLSupport";

export type { BoardExplorerProps } from "./types";

// The WebGL canvas only ever loads in the browser (static export, no SSR).
const BoardCanvas = dynamic(() => import("./scene/BoardCanvas"), { ssr: false });

class CanvasErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[board-explorer] 3D view failed, showing static fallback", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Preparing({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="label flex items-center gap-2 text-faint">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
        Preparing board model
      </div>
    </div>
  );
}

/**
 * Interactive 3D logic-board explorer. Client-only safe: renders nothing heavy
 * on the server, lazy-loads the R3F canvas, and degrades to a static plan view
 * with region buttons when WebGL is unavailable or the context is lost.
 */
export default function BoardExplorer(props: BoardExplorerProps) {
  const { regions, statuses, selectedId, onSelect, className } = props;
  const support = useWebGLSupport();
  const prefersReduced = usePrefersReducedMotion();
  const reducedMotion = props.reducedMotion ?? prefersReduced;
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);

  const handleReady = useCallback(() => setReady(true), []);
  const handleLost = useCallback(() => {
    setLost(true);
    setReady(false);
  }, []);

  const fallback = (reason: string) => (
    <BoardFallback regions={regions} statuses={statuses} selectedId={selectedId} onSelect={onSelect} reason={reason} />
  );

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[#0e1314] ${className ?? ""}`}
      data-board-explorer=""
      data-board-ready={ready ? "true" : "false"}
    >
      {support === "no" && fallback("3D view unavailable: this browser or device does not provide WebGL.")}
      {support === "yes" && !lost && (
        <CanvasErrorBoundary fallback={fallback("The 3D view could not start on this device.")}>
          <div
            className="absolute inset-0"
            style={{ opacity: ready ? 1 : 0, transition: reducedMotion ? "none" : "opacity 450ms ease-out" }}
          >
            <BoardCanvas key={canvasKey} {...props} reducedMotion={reducedMotion} onReady={handleReady} onContextLost={handleLost} />
          </div>
        </CanvasErrorBoundary>
      )}
      {support !== "no" && !lost && <Preparing visible={!ready} />}
      {lost && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="label">3D view paused</div>
          <p className="max-w-[44ch] text-[12px] text-muted">
            The graphics context was lost (the GPU was reset or reclaimed). Your inspection data is unaffected.
          </p>
          <button
            type="button"
            onClick={() => {
              setLost(false);
              setCanvasKey((k) => k + 1);
            }}
            className="mono rounded-sm border border-line-strong bg-raised px-3 py-1.5 text-[11px] text-ink hover:border-muted"
          >
            Reload 3D view
          </button>
        </div>
      )}
      {support === "yes" && !lost && (
        <RegionKeyboardNav regions={regions} statuses={statuses} selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}
