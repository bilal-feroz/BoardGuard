import type { BoardRegion, RegionStatus } from "@/lib/regions";

export const STATUS_COLOR: Record<RegionStatus, string> = {
  unvisited: "#9ba7a7",
  active: "#f0f0eb",
  attention: "#d8aa68",
  critical: "#d67c73",
  complete: "#79ada0",
};

/** Status word: severity is never conveyed by colour alone. */
export const STATUS_WORD: Record<RegionStatus, string> = {
  unvisited: "not inspected",
  active: "inspecting",
  attention: "review",
  critical: "issue",
  complete: "done",
};

const SHORT_NAMES: Record<string, string> = {
  "REGION-A": "Battery & B2B",
  "REGION-B": "QFP controller",
  "REGION-C": "Test pads",
  "REGION-D": "PMIC cluster",
  "REGION-E": "RF shield",
};

export function shortName(r: BoardRegion): string {
  return SHORT_NAMES[r.id] ?? r.label;
}

export function statusOf(statuses: Record<string, RegionStatus>, id: string): RegionStatus {
  return statuses[id] ?? "unvisited";
}

/** Colour used for a region's outline/label, accounting for selection. */
export function displayColor(status: RegionStatus, selected: boolean): string {
  if (selected && status === "unvisited") return STATUS_COLOR.active;
  return STATUS_COLOR[status];
}

export function StatusGlyph({ status, size = 9, color }: { status: RegionStatus; size?: number; color?: string }) {
  const c = color ?? STATUS_COLOR[status];
  const common = { width: size, height: size, viewBox: "0 0 10 10", "aria-hidden": true, style: { flex: "none", display: "block" } } as const;
  switch (status) {
    case "complete":
      return (
        <svg {...common}>
          <path d="M1.5 5.4 4 7.8 8.6 2.4" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="square" />
        </svg>
      );
    case "critical":
      return (
        <svg {...common}>
          <path d="M5 0.8 9.2 5 5 9.2 0.8 5Z" fill={c} />
        </svg>
      );
    case "attention":
      return (
        <svg {...common}>
          <path d="M5 1.2 9.2 8.8H0.8Z" fill="none" stroke={c} strokeWidth="1.4" strokeLinejoin="miter" />
        </svg>
      );
    case "active":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.9" fill="none" stroke={c} strokeWidth="1.2" />
          <circle cx="5" cy="5" r="1.6" fill={c} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.7" fill="none" stroke={c} strokeWidth="1.2" />
        </svg>
      );
  }
}
