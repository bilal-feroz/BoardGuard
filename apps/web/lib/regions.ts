// Inspection regions on the representational 3D logic board.
//
// The 3D board is a generic, procedurally modelled assembly. It is NOT a scan
// of the boards in the demo images; regions are grounded data objects that
// link a board area to inspection scenarios and their captures.

export type RegionStatus = "unvisited" | "active" | "attention" | "critical" | "complete";

export interface BoardRegion {
  id: string;
  label: string;
  description: string;
  /** Centre of the region in normalised board coordinates (0..1, origin top-left, u to the right, v down). */
  u: number;
  v: number;
  /** Size in normalised board coordinates. */
  w: number;
  h: number;
  /** Scenario that inspects this region, if any. */
  scenarioId?: string;
}

export const BOARD_SIZE_MM = { width: 150, height: 80, thickness: 1.0 };

export const REGIONS: BoardRegion[] = [
  {
    id: "REGION-A",
    label: "Board-to-board connector",
    description: "Fine-pitch FPC connector near the battery edge; common site of liquid ingress.",
    u: 0.16, v: 0.3, w: 0.16, h: 0.09,
    scenarioId: "S01-corrosion",
  },
  {
    id: "REGION-B",
    label: "Fine-pitch controller IC",
    description: "QFP controller with ~0.5 mm lead pitch; solder bridges form between adjacent leads.",
    u: 0.5, v: 0.46, w: 0.17, h: 0.24,
    scenarioId: "S02-bridge-glare",
  },
  {
    id: "REGION-C",
    label: "Exposed trace & test pads",
    description: "Test pads and an exposed trace run used for before/after cleaning verification.",
    u: 0.8, v: 0.68, w: 0.17, h: 0.16,
    scenarioId: "S03-verification",
  },
  {
    id: "REGION-D",
    label: "Power management cluster",
    description: "PMIC with dense 0201/0402 passives. No scenario attached.",
    u: 0.78, v: 0.27, w: 0.16, h: 0.18,
  },
  {
    id: "REGION-E",
    label: "Shielded RF section",
    description: "Stamped shield can over the RF front end. No scenario attached.",
    u: 0.24, v: 0.72, w: 0.2, h: 0.2,
  },
];
