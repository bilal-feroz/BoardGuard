"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BoardExplorer } from "@/features/board-explorer";
import { Icon } from "@/components/icons";
import { apiUrl } from "@/lib/api";
import { REGIONS } from "@/lib/regions";
import { regionStatuses, useStore } from "@/lib/store";
import MicroscopeView from "../microscope/MicroscopeView";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(RM_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}

export function ProcessingBar() {
  const busy = useStore((s) => s.busy);
  const env = useStore((s) => s.apiEnv);
  if (!busy) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20" role="status" aria-live="polite">
      <div className="h-[2px] overflow-hidden bg-line">
        <div className="h-full w-1/3 animate-[bg-scan_1.1s_ease-in-out_infinite] bg-ink/70" style={{ animationName: "bg-slide" }} />
      </div>
      <div className="mono absolute right-3 top-2.5 rounded-[3px] border border-line bg-bg/90 px-2 py-0.5 text-[10.5px] text-ink-2">
        {busy.label} · OpenCV on {env === "aws-lambda" ? "AWS Lambda" : env ?? "API"}
      </div>
      <style>{`@keyframes bg-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}

export function ErrorToast() {
  const error = useStore((s) => s.error);
  const clear = useStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div role="alert" className="enter absolute bottom-4 right-4 z-30 max-w-md rounded-[4px] border border-coral/50 bg-panel px-3.5 py-2.5 shadow-xl shadow-black/50">
      <div className="flex items-start gap-2.5">
        <Icon.Alert className="mt-0.5 shrink-0 text-coral" size={14} />
        <div className="min-w-0 flex-1">
          <div className="mono text-[11px] text-coral">{error.code}</div>
          <div className="text-[12.5px] text-ink">{error.message}</div>
        </div>
        <button type="button" aria-label="Dismiss" onClick={clear} className="text-muted hover:text-ink"><Icon.X size={14} /></button>
      </div>
    </div>
  );
}

export default function MainCanvas() {
  const session = useStore((s) => s.session);
  const scenarios = useStore((s) => s.scenarios);
  const canvasMode = useStore((s) => s.canvasMode);
  const setCanvasMode = useStore((s) => s.setCanvasMode);
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const selectRegion = useStore((s) => s.selectRegion);
  const focusRegionId = useStore((s) => s.focusRegionId);
  const focusRegion = useStore((s) => s.focusRegion);
  const selectedObsId = useStore((s) => s.selectedObsId);
  const selectObs = useStore((s) => s.selectObs);
  const reduced = usePrefersReducedMotion();
  const [settled, setSettled] = useState<string | null>(null);

  const obs = session?.observations.find((o) => o.obs_id === selectedObsId) ?? session?.observations[session.observations.length - 1];
  const statuses = useMemo(() => regionStatuses(session, scenarios), [session, scenarios]);
  const hasObs = !!session?.observations.length;

  // Board -> microscope hand-off: once the camera has framed the session's region and a capture exists, cross-fade.
  useEffect(() => {
    if (canvasMode === "board" && hasObs && session?.board_region && settled === session.board_region && focusRegionId === session.board_region) {
      const t = setTimeout(() => setCanvasMode("microscope"), reduced ? 0 : 250);
      return () => clearTimeout(t);
    }
  }, [canvasMode, hasObs, session?.board_region, settled, focusRegionId, setCanvasMode, reduced]);

  // Sessions without a board region (custom uploads) go straight to the microscope.
  useEffect(() => {
    if (hasObs && !session?.board_region) setCanvasMode("microscope");
  }, [hasObs, session?.board_region, setCanvasMode]);

  const showMicro = canvasMode === "microscope" && !!obs;

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-bg">
      <div className={`absolute inset-0 transition-opacity duration-500 ${showMicro ? "pointer-events-none opacity-0" : "opacity-100"}`} aria-hidden={showMicro}>
        <BoardExplorer
          regions={REGIONS}
          statuses={statuses}
          selectedId={selectedRegionId}
          focusId={focusRegionId}
          onSelect={(id) => selectRegion(id)}
          onFocusSettled={(id) => setSettled(id)}
          reducedMotion={reduced}
        />
        {!session && (
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-sm">
            <p className="mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Representative board model</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
              Generic logic-board model for navigation. Regions link to recorded captures; the model is not a scan of the imaged boards.
            </p>
          </div>
        )}
        {hasObs && canvasMode === "board" && (
          <button type="button" onClick={() => setCanvasMode("microscope")}
            className="absolute bottom-4 right-4 inline-flex h-8 items-center gap-2 rounded-[4px] border border-line-strong bg-panel/90 px-3 text-[12px] text-ink hover:bg-raised">
            <Icon.Scope size={14} /> Open microscope view
          </button>
        )}
      </div>

      <div className={`absolute inset-0 transition-opacity duration-500 ${showMicro ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        {obs && <MicroscopeView obs={obs} />}
        {session && session.observations.length > 0 && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            {session.observations.map((o) => (
              <button key={o.obs_id} type="button" onClick={() => selectObs(o.obs_id)} aria-pressed={o.obs_id === obs?.obs_id}
                className={`group relative h-12 w-16 overflow-hidden rounded-[3px] border ${o.obs_id === obs?.obs_id ? "border-ink" : "border-line hover:border-line-strong"}`}
                title={`${o.obs_id} · ${o.role} · ${o.quality?.verdict ?? ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={apiUrl(o.capture_url)} alt="" className="h-full w-full object-cover opacity-80 group-hover:opacity-100" />
                <span className="mono absolute inset-x-0 bottom-0 bg-bg/85 px-1 text-[9.5px] text-ink">{o.obs_id.replace("OBS-", "#")}</span>
                <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${o.quality?.verdict === "REJECT" ? "bg-coral" : o.quality?.verdict === "MARGINAL" ? "bg-amber" : "bg-teal"}`} />
              </button>
            ))}
            <button type="button" onClick={() => { setCanvasMode("board"); focusRegion(null); setTimeout(() => focusRegion(session.board_region), 30); }}
              className="grid h-12 w-10 place-items-center rounded-[3px] border border-line text-muted hover:border-line-strong hover:text-ink" title="Back to board">
              <Icon.Chip size={15} />
            </button>
          </div>
        )}
      </div>
      <ProcessingBar />
      <ErrorToast />
    </div>
  );
}
