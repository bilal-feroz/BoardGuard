"use client";

import type { BoardRegion, RegionStatus } from "@/lib/regions";
import { BOARD_OUTLINE, MOUNTING_HOLES } from "./model/outline";
import { BOARD_H, BOARD_W } from "./model/units";
import { displayColor, shortName, StatusGlyph, STATUS_WORD, statusOf } from "./status";

const OUTLINE_D = BOARD_OUTLINE.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + "Z";

/**
 * Shown when WebGL is unavailable (or the 3D view failed): a static plan view of
 * the board with the same regions, plus a list of buttons that still drive selection.
 */
export function BoardFallback({
  regions,
  statuses,
  selectedId,
  onSelect,
  reason,
}: {
  regions: BoardRegion[];
  statuses: Record<string, RegionStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reason: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col gap-4 overflow-auto p-5 text-ink-2">
      <div className="label">Board map · static view</div>
      <p className="max-w-[60ch] text-[12px] text-muted">{reason} The inspection regions are still available below.</p>
      <svg
        viewBox={`-4 -4 ${BOARD_W + 8} ${BOARD_H + 8}`}
        className="w-full max-w-[720px]"
        role="img"
        aria-label="Plan view of the logic board with inspection regions"
      >
        <path d={OUTLINE_D} fill="#164e3c" stroke="#2f6b56" strokeWidth={0.5} />
        {MOUNTING_HOLES.map((h, i) => (
          <g key={i}>
            <circle cx={h.x} cy={h.y} r={h.ring} fill="#c8a965" />
            <circle cx={h.x} cy={h.y} r={h.r} fill="#0e1314" />
          </g>
        ))}
        {regions.map((r) => {
          const status = statusOf(statuses, r.id);
          const selected = selectedId === r.id;
          const color = displayColor(status, selected);
          const x = (r.u - r.w / 2) * BOARD_W;
          const y = (r.v - r.h / 2) * BOARD_H;
          return (
            <g key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: "pointer" }}>
              <rect
                x={x}
                y={y}
                width={r.w * BOARD_W}
                height={r.h * BOARD_H}
                fill={selected ? color : "transparent"}
                fillOpacity={selected ? 0.12 : 0}
                stroke={color}
                strokeWidth={selected ? 0.7 : 0.45}
              />
              <text x={x + 1} y={y - 1.2} fontSize={3} fill={color} fontFamily="var(--font-plex-mono), monospace">
                {r.id.replace("REGION-", "")}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="flex max-w-[520px] flex-col gap-px">
        {regions.map((r) => {
          const status = statusOf(statuses, r.id);
          const selected = selectedId === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : r.id)}
                className="mono flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left text-[11.5px] hover:border-line aria-pressed:border-line-strong aria-pressed:bg-raised"
              >
                <StatusGlyph status={status} color={displayColor(status, selected)} />
                <span className="text-ink">{r.id}</span>
                <span className="text-faint">·</span>
                <span>{shortName(r)}</span>
                <span className="ml-auto text-muted">{STATUS_WORD[status]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
