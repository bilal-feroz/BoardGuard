"use client";

import type { MutableRefObject } from "react";
import type { BoardRegion, RegionStatus } from "@/lib/regions";
import { displayColor, shortName, StatusGlyph, STATUS_WORD, statusOf } from "../status";

export type LabelRegistry = MutableRefObject<Map<string, HTMLElement>>;

/**
 * DOM labels for the regions, rendered as a sibling layer of the canvas (no
 * nested React roots). Their screen positions are written every rendered frame
 * by <RegionOverlays> via the shared registry.
 */
export function RegionLabels({
  regions,
  statuses,
  selectedId,
  focusId,
  hoveredId,
  onSelect,
  onHover,
  registry,
}: {
  regions: BoardRegion[];
  statuses: Record<string, RegionStatus>;
  selectedId: string | null;
  focusId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  registry: LabelRegistry;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {regions.map((r) => {
        const status = statusOf(statuses, r.id);
        const selected = selectedId === r.id;
        const focused = focusId === r.id;
        const hovered = hoveredId === r.id;
        const emphasis = selected || hovered || focused;
        const compact = !selected && !focused;
        const show = focusId === null || focused;
        const color = displayColor(status, selected);
        return (
          <div
            key={r.id}
            ref={(el) => {
              if (el) registry.current.set(r.id, el);
              else registry.current.delete(r.id);
            }}
            data-region-label={r.id}
            style={{ position: "absolute", left: 0, top: 0, willChange: "transform", visibility: "hidden" }}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.id);
              }}
              onPointerEnter={() => onHover(r.id)}
              onPointerLeave={() => onHover(null)}
              className="mono"
              style={{
                pointerEvents: show ? "auto" : "none",
                opacity: show ? 1 : 0,
                position: "absolute",
                left: -1,
                bottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                padding: compact ? "2px 6px 2px 5px" : "3px 8px 3px 6px",
                fontSize: compact ? 10.5 : 11,
                lineHeight: "14px",
                letterSpacing: "0.02em",
                color: emphasis ? "#f0f0eb" : "#c9cdc8",
                background: emphasis ? "rgba(17,23,25,0.92)" : "rgba(17,23,25,0.74)",
                borderStyle: "solid",
                borderWidth: "1px 1px 1px 2px",
                borderTopColor: emphasis ? color : "rgba(155,167,167,0.28)",
                borderRightColor: emphasis ? color : "rgba(155,167,167,0.28)",
                borderBottomColor: emphasis ? color : "rgba(155,167,167,0.28)",
                borderLeftColor: color,
                borderRadius: 2,
                cursor: "pointer",
                userSelect: "none",
                transition: "background 120ms, border-color 120ms, opacity 160ms",
              }}
            >
              <StatusGlyph status={status} color={color} />
              <span style={{ color: emphasis ? "#f0f0eb" : "#9ba7a7" }}>{r.id}</span>
              <span style={{ color: "#6c7878" }}>·</span>
              <span>{shortName(r)}</span>
              {(!compact || status !== "unvisited") && (
                <span style={{ color }}>
                  <span style={{ color: "#6c7878" }}>· </span>
                  {STATUS_WORD[status]}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
