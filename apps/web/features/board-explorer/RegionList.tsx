"use client";

import type { BoardRegion, RegionStatus } from "@/lib/regions";
import { displayColor, shortName, StatusGlyph, STATUS_WORD, statusOf } from "./status";

/**
 * Keyboard / screen-reader access to the regions. Visually hidden until one of
 * its buttons receives focus, then it appears as a compact list over the canvas.
 */
export function RegionKeyboardNav({
  regions,
  statuses,
  selectedId,
  onSelect,
}: {
  regions: BoardRegion[];
  statuses: Record<string, RegionStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav
      aria-label="Board inspection regions"
      className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-30"
    >
      <ul className="flex flex-col gap-px rounded-sm border border-line bg-panel/95 p-1 shadow-lg">
        {regions.map((r) => {
          const status = statusOf(statuses, r.id);
          const selected = selectedId === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : r.id)}
                className="mono flex w-full items-center gap-2 rounded-[2px] px-2 py-1 text-left text-[11px] text-ink-2 hover:bg-raised aria-pressed:bg-raised aria-pressed:text-ink"
              >
                <StatusGlyph status={status} color={displayColor(status, selected)} />
                <span>{r.id}</span>
                <span className="text-faint">·</span>
                <span>{shortName(r)}</span>
                <span className="text-muted">· {STATUS_WORD[status]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
