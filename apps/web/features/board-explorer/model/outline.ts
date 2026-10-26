import { BOARD_H, BOARD_W } from "./units";

export type Pt = [number, number];

/** Board outline corners in mm, clockwise in drawing space, with router radius per corner. */
const OUTLINE_CORNERS: Array<[number, number, number]> = [
  [0, 0, 3],
  [BOARD_W, 0, 3],
  [BOARD_W, 60, 1.2],
  [140, 60, 1.0], // concave step (removed corner for the speaker module)
  [140, BOARD_H, 1.2],
  [84, BOARD_H, 1.0],
  [84, 73, 1.0], // bottom notch (vibration motor clearance)
  [58, 73, 1.0],
  [58, BOARD_H, 1.0],
  [0, BOARD_H, 3],
];

function roundedPolygon(corners: Array<[number, number, number]>, segments = 8): Pt[] {
  const out: Pt[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = [corners[(i - 1 + n) % n][0], corners[(i - 1 + n) % n][1]];
    const [cx, cy, r] = corners[i];
    const [nx, ny] = [corners[(i + 1) % n][0], corners[(i + 1) % n][1]];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cx - ((cx - px) / l1) * rr;
    const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx + ((nx - cx) / l2) * rr;
    const by = cy + ((ny - cy) / l2) * rr;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const it = 1 - t;
      // Quadratic bezier with the corner as control point: visually a router arc.
      out.push([it * it * ax + 2 * it * t * cx + t * t * bx, it * it * ay + 2 * it * t * cy + t * t * by]);
    }
  }
  return out;
}

export const BOARD_OUTLINE: Pt[] = roundedPolygon(OUTLINE_CORNERS);

export interface Hole {
  x: number;
  y: number;
  /** drill radius, mm */
  r: number;
  /** plated ring outer radius, mm */
  ring: number;
}

export const MOUNTING_HOLES: Hole[] = [
  { x: 4.2, y: 4.2, r: 0.8, ring: 1.75 },
  { x: BOARD_W - 4.2, y: 4.2, r: 0.8, ring: 1.75 },
  { x: 4.2, y: BOARD_H - 4.2, r: 0.8, ring: 1.75 },
  { x: 135.6, y: BOARD_H - 4.2, r: 0.8, ring: 1.75 },
  { x: 66.5, y: 4.2, r: 0.8, ring: 1.75 },
];

/** Rectangles (mm) that are NOT board material inside the bounding box. */
export const OUTLINE_VOIDS: Array<[number, number, number, number]> = [
  [140, 60, BOARD_W, BOARD_H],
  [58, 73, 84, BOARD_H],
];

/** True if (x, y) is on the board with at least `margin` mm to any edge or hole. */
export function onBoard(x: number, y: number, margin = 0): boolean {
  if (x < margin || y < margin || x > BOARD_W - margin || y > BOARD_H - margin) return false;
  for (const [x0, y0, x1, y1] of OUTLINE_VOIDS) {
    if (x > x0 - margin && x < x1 + margin && y > y0 - margin && y < y1 + margin) return false;
  }
  for (const h of MOUNTING_HOLES) {
    if (Math.hypot(x - h.x, y - h.y) < h.ring + 0.6 + margin) return false;
  }
  return true;
}
