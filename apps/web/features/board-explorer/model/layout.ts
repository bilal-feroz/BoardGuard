/**
 * Procedural but deterministic logic-board layout, authored in millimetres.
 *
 * This is the single source of truth for both the PCB textures (pads, traces,
 * vias, silkscreen) and the 3D components, so copper, solder and parts line up.
 * Large parts are hand-placed around the inspection regions in lib/regions.ts;
 * routing and passive clusters are generated with an occupancy grid so nothing
 * overlaps and every passive sits in an orderly, plausible array.
 */
import { BOARD_H, BOARD_W } from "./units";
import { MOUNTING_HOLES, onBoard, type Pt } from "./outline";
import { mulberry32, OccGrid } from "./rng";

export type ChipSize = "0201" | "0402" | "0603";
/** C = MLCC, R = thick-film resistor, F = ferrite bead / small inductor */
export type ChipKind = "C" | "R" | "F";

export interface ChipDims {
  L: number;
  W: number;
  H: number;
  Hr: number;
  term: number;
  padL: number;
  padW: number;
  cc: number;
}

export const CHIP_DIMS: Record<ChipSize, ChipDims> = {
  "0201": { L: 0.6, W: 0.3, H: 0.3, Hr: 0.23, term: 0.15, padL: 0.3, padW: 0.34, cc: 0.56 },
  "0402": { L: 1.0, W: 0.5, H: 0.5, Hr: 0.35, term: 0.25, padL: 0.5, padW: 0.56, cc: 0.98 },
  "0603": { L: 1.6, W: 0.8, H: 0.8, Hr: 0.45, term: 0.35, padL: 0.8, padW: 0.9, cc: 1.62 },
};

export interface Chip {
  x: number;
  y: number;
  size: ChipSize;
  kind: ChipKind;
  /** 0: long axis along board x, 90: along board y */
  rot: 0 | 90;
  /** 0..1, used for subtle per-part colour variation */
  tone: number;
}

export type PartKind = "bga" | "qfp" | "qfn" | "wlcsp" | "b2b" | "shield" | "crystal" | "inductor" | "tantalum";

export interface Part {
  ref: string;
  kind: PartKind;
  x: number;
  y: number;
  /** body extent along board x / y (mm) */
  w: number;
  h: number;
  height: number;
  /** b2b: 90 = pin rows run along board y. tantalum: 90 = anode towards -y */
  rot?: 0 | 90;
  /** qfp / qfn: pins per side. b2b: pins per row */
  pins?: number;
  pitch?: number;
  marking?: string[];
  silk?: "below" | "above" | "left" | "right" | "none";
}

export type Finish = "enig" | "solder";

export interface Pad {
  x: number;
  y: number;
  w: number;
  h: number;
  round?: boolean;
  finish: Finish;
}

export type TraceKind = "signal" | "power" | "rf" | "exposed";

export interface Trace {
  pts: Pt[];
  w: number;
  kind: TraceKind;
}

export interface Via {
  x: number;
  y: number;
  /** outer (annular ring) diameter */
  d: number;
}

export interface SilkText {
  text: string;
  x: number;
  y: number;
  size: number;
  rot?: number;
  align?: CanvasTextAlign;
  weight?: number;
}

export interface SilkPath {
  pts: Pt[];
  closed?: boolean;
  w: number;
  fill?: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BoardLayout {
  parts: Part[];
  chips: Chip[];
  pads: Pad[];
  traces: Trace[];
  vias: Via[];
  silkText: SilkText[];
  silkPaths: SilkPath[];
  /** solder-mask openings that expose bare laminate (exposed trace run) */
  windows: Rect[];
  /** copper islands / split planes under the mask */
  islands: Pt[][];
  fiducials: Pt[];
  /** solder fence under the RF shield */
  shieldFence: Rect[];
  /** QFP lead positions are derived from the part, exposed here for the 3D model */
  testPoints: Array<{ x: number; y: number; ref: string }>;
}

// ---------------------------------------------------------------------------
// Geometry helpers

function offsetPolyline(pts: Pt[], off: number): Pt[] {
  if (off === 0) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [];
  const n = pts.length;
  const normals: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    normals.push([-dy / l, dx / l]);
  }
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push([pts[0][0] + normals[0][0] * off, pts[0][1] + normals[0][1] * off]);
    } else if (i === n - 1) {
      const nn = normals[n - 2];
      out.push([pts[i][0] + nn[0] * off, pts[i][1] + nn[1] * off]);
    } else {
      const a = normals[i - 1];
      const b = normals[i];
      let mx = a[0] + b[0];
      let my = a[1] + b[1];
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const cos = mx * a[0] + my * a[1];
      const s = off / Math.max(cos, 0.3);
      out.push([pts[i][0] + mx * s, pts[i][1] + my * s]);
    }
  }
  return out;
}

function serpentine(x0: number, x1: number, y: number, amp: number, period: number): Pt[] {
  const pts: Pt[] = [[x0, y]];
  const c = Math.min(0.12, period / 8);
  let x = x0 + 0.6;
  pts.push([x, y]);
  while (x + period <= x1 - 0.6) {
    const half = period / 2;
    pts.push([x + c, y - c]);
    pts.push([x + c, y - amp + c]);
    pts.push([x + 2 * c, y - amp]);
    pts.push([x + half - c, y - amp]);
    pts.push([x + half, y - amp + c]);
    pts.push([x + half, y - c]);
    pts.push([x + half + c, y]);
    x += period;
    pts.push([x, y]);
  }
  pts.push([x1, y]);
  return pts;
}

// ---------------------------------------------------------------------------

function buildLayout(): BoardLayout {
  const rnd = mulberry32(0x2614c);
  const occ = new OccGrid(BOARD_W, BOARD_H, 0.1); // copper features + part bodies
  const padOcc = new OccGrid(BOARD_W, BOARD_H, 0.1); // exposed metal + bodies (silk must avoid)
  const textOcc = new OccGrid(BOARD_W, BOARD_H, 0.1);

  const parts: Part[] = [];
  const chips: Chip[] = [];
  const pads: Pad[] = [];
  const traces: Trace[] = [];
  const vias: Via[] = [];
  const silkText: SilkText[] = [];
  const silkPaths: SilkPath[] = [];
  const windows: Rect[] = [];
  const islands: Pt[][] = [];
  const fiducials: Pt[] = [];
  const shieldFence: Rect[] = [];
  const testPoints: BoardLayout["testPoints"] = [];

  const addPad = (p: Pad) => {
    pads.push(p);
    padOcc.markRect(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
    occ.markRect(p.x - p.w / 2 - 0.1, p.y - p.h / 2 - 0.1, p.x + p.w / 2 + 0.1, p.y + p.h / 2 + 0.1);
  };
  const addTrace = (pts: Pt[], w: number, kind: TraceKind = "signal", clearance = 0.12) => {
    traces.push({ pts, w, kind });
    for (let i = 0; i < pts.length - 1; i++) {
      occ.markSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w / 2 + clearance);
    }
  };
  const addVia = (x: number, y: number, d = 0.45) => {
    vias.push({ x, y, d });
    occ.markCircle(x, y, d / 2 + 0.1);
  };
  const viaFree = (x: number, y: number, d = 0.45) => onBoard(x, y, 0.7) && occ.freeCircle(x, y, d / 2 + 0.1);

  // -------------------------------------------------------------------------
  // Major parts

  const P = (p: Part) => {
    parts.push(p);
    const m = 0.3;
    occ.markRect(p.x - p.w / 2 - m, p.y - p.h / 2 - m, p.x + p.w / 2 + m, p.y + p.h / 2 + m);
    padOcc.markRect(p.x - p.w / 2 - 0.15, p.y - p.h / 2 - 0.15, p.x + p.w / 2 + 0.15, p.y + p.h / 2 + 0.15);
    return p;
  };

  const soc = P({ ref: "U1", kind: "bga", x: 47, y: 31, w: 14, h: 14, height: 1.05, marking: ["BG7140", "APX-2614 TW", "1C3 0021", "LPX4 128G"], silk: "above" });
  const nand = P({ ref: "U2", kind: "bga", x: 96, y: 58, w: 11, h: 13, height: 0.95, marking: ["NX256-UFS", "2611 KR", "P4A3 0742"], silk: "right" });
  const qfp = P({ ref: "U3", kind: "qfp", x: 75, y: 36.8, w: 12, h: 12, height: 1.4, pins: 20, pitch: 0.5, marking: ["BGC-M480", "QF80 2609", "e3 7KA21"], silk: "none" });
  const pmic = P({ ref: "U4", kind: "qfn", x: 114, y: 21.6, w: 6, h: 6, height: 0.85, pins: 12, pitch: 0.4, marking: ["BPM-6A1", "2612", "Q48 A"], silk: "none" });
  P({ ref: "U6", kind: "wlcsp", x: 134.5, y: 20, w: 3.2, h: 3.2, height: 0.5, silk: "below" });
  const u7 = P({ ref: "U7", kind: "qfn", x: 64, y: 61, w: 4, h: 4, height: 0.8, pins: 6, pitch: 0.5, marking: ["BC31", "2610"], silk: "below" });
  P({ ref: "U8", kind: "wlcsp", x: 74, y: 63.5, w: 2.4, h: 2.0, height: 0.45, silk: "below" });
  P({ ref: "U9", kind: "wlcsp", x: 11, y: 38, w: 3.4, h: 3.0, height: 0.5, silk: "below" });
  const u10 = P({ ref: "U10", kind: "qfn", x: 30, y: 9.5, w: 3, h: 3, height: 0.75, pins: 4, pitch: 0.5, marking: ["BQ2", "609"], silk: "below" });
  P({ ref: "U12", kind: "wlcsp", x: 104, y: 40.6, w: 2.6, h: 2.6, height: 0.5, silk: "below" });
  const u13 = P({ ref: "U13", kind: "qfn", x: 128, y: 8, w: 3.5, h: 3.5, height: 0.75, pins: 5, pitch: 0.5, marking: ["BA7", "2608"], silk: "below" });
  const j1 = P({ ref: "J1", kind: "b2b", x: 24, y: 24, w: 16, h: 3.5, height: 0.9, pins: 34, pitch: 0.4, silk: "left" });
  const j2 = P({ ref: "J2", kind: "b2b", x: 141.5, y: 36, w: 3.5, h: 13, height: 0.9, pins: 28, pitch: 0.4, rot: 90, silk: "above" });
  const j3 = P({ ref: "J3", kind: "b2b", x: 88, y: 7, w: 10, h: 2.8, height: 0.8, pins: 20, pitch: 0.4, silk: "left" });
  const shield = P({ ref: "SH1", kind: "shield", x: 36, y: 57.6, w: 27, h: 13, height: 1.3, silk: "none" });
  P({ ref: "Y1", kind: "crystal", x: 59.6, y: 23.2, w: 2.0, h: 1.6, height: 0.55, silk: "right" });
  P({ ref: "Y2", kind: "crystal", x: 85.6, y: 45.3, w: 2.0, h: 1.6, height: 0.55, silk: "none" });
  P({ ref: "Y3", kind: "crystal", x: 18.5, y: 44.5, w: 3.2, h: 2.5, height: 0.7, silk: "below" });
  const inductorYs = [16.7, 19.3, 21.9, 24.5];
  inductorYs.forEach((y, i) =>
    P({ ref: `L${i + 1}`, kind: "inductor", x: 124.6, y, w: 2.5, h: 2.0, height: 1.0, marking: [i % 2 ? "1R0" : "R47"], silk: "none" }),
  );
  P({ ref: "L5", kind: "inductor", x: 100, y: 21.6, w: 3.2, h: 2.5, height: 1.2, marking: ["2R2"], silk: "below" });
  P({ ref: "L6", kind: "inductor", x: 9.5, y: 31.5, w: 2.5, h: 2.0, height: 1.0, marking: ["R68"], silk: "right" });
  P({ ref: "C1", kind: "tantalum", x: 8, y: 47.5, w: 2.8, h: 3.5, height: 1.6, rot: 90, marking: ["107", "6K"], silk: "below" });
  P({ ref: "C2", kind: "tantalum", x: 12.6, y: 47.5, w: 2.8, h: 3.5, height: 1.6, rot: 90, marking: ["107", "6K"], silk: "below" });
  P({ ref: "C3", kind: "tantalum", x: 107, y: 34.2, w: 3.5, h: 2.8, height: 1.6, marking: ["227", "4D"], silk: "below" });
  P({ ref: "C4", kind: "tantalum", x: 112, y: 34.2, w: 3.5, h: 2.8, height: 1.6, marking: ["227", "4D"], silk: "below" });

  // -------------------------------------------------------------------------
  // Region C: test pads + exposed trace run (kept tidy, it is an inspection target)

  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 5; k++) {
      const x = 111 + k * 3.0;
      const y = 50.6 + row * 3.0;
      const ref = `TP${row * 5 + k + 1}`;
      addPad({ x, y, w: 1.2, h: 1.2, round: true, finish: "enig" });
      testPoints.push({ x, y, ref });
    }
  }
  [50.6, 53.6].forEach((y, i) => {
    addPad({ x: 127.4, y, w: 1.8, h: 1.1, finish: "enig" });
    testPoints.push({ x: 127.4, y, ref: `TP${11 + i}` });
  });
  const win: Rect = { x0: 109.4, y0: 56.3, x1: 131.2, y1: 60.0 };
  windows.push(win);
  occ.markRect(win.x0 - 0.2, win.y0 - 0.2, win.x1 + 0.2, win.y1 + 0.2);
  padOcc.markRect(win.x0, win.y0, win.x1, win.y1);
  for (let k = 0; k < 5; k++) {
    const y = 56.85 + k * 0.65;
    const xa = 106.2 - (k % 2) * 0.6;
    const xb = 133.6 + (k % 2) * 0.6;
    traces.push({ pts: [[xa, y], [xb, y]], w: 0.3, kind: "exposed" });
    occ.markSegment(xa, y, xb, y, 0.3);
    addVia(xa - 0.35, y, 0.5);
    addVia(xb + 0.35, y, 0.5);
  }
  // test pad stubs to vias
  testPoints.forEach((tp, i) => {
    const vy = tp.y + (i < 5 ? -1.2 : 1.25);
    if (i >= 10) return;
    const vx = tp.x + 0.9;
    traces.push({ pts: [[tp.x, tp.y], [tp.x + 0.45, tp.y + (vy - tp.y) * 0.5], [vx, vy]], w: 0.2, kind: "signal" });
    occ.markSegment(tp.x, tp.y, vx, vy, 0.22);
    addVia(vx, vy, 0.5);
  });

  // -------------------------------------------------------------------------
  // Pads for packages

  // QFP: 20 leads / side, 0.5 mm pitch, gull-wing feet land on 1.3 mm pads.
  {
    const N = qfp.pins!;
    const pitch = qfp.pitch!;
    const sides: Array<{ n: Pt; t: Pt }> = [
      { n: [0, -1], t: [1, 0] },
      { n: [1, 0], t: [0, 1] },
      { n: [0, 1], t: [-1, 0] },
      { n: [-1, 0], t: [0, -1] },
    ];
    sides.forEach(({ n, t }, si) => {
      for (let i = 0; i < N; i++) {
        const s = (i - (N - 1) / 2) * pitch;
        const cx = qfp.x + n[0] * 6.9 + t[0] * s;
        const cy = qfp.y + n[1] * 6.9 + t[1] * s;
        const along = n[0] !== 0;
        addPad({ x: cx, y: cy, w: along ? 1.3 : 0.27, h: along ? 0.27 : 1.3, finish: "solder" });
        // fan-out
        const p0: Pt = [qfp.x + n[0] * 7.55 + t[0] * s, qfp.y + n[1] * 7.55 + t[1] * s];
        const p1: Pt = [p0[0] + n[0] * 0.55, p0[1] + n[1] * 0.55];
        const dl = Math.abs(s) * 0.55;
        const sg = Math.sign(s);
        const p2: Pt = [p1[0] + n[0] * dl + t[0] * sg * dl, p1[1] + n[1] * dl + t[1] * sg * dl];
        const isLeft = si === 3;
        if (isLeft && p2[1] > soc.y - soc.h / 2 + 0.6 && p2[1] < soc.y + soc.h / 2 - 0.6) {
          addTrace([p0, p1, p2, [soc.x + soc.w / 2 - 0.6, p2[1]]], 0.12);
        } else {
          const L = si === 2 ? 0.25 + (i % 2) * 0.55 : 0.45 + (i % 2) * 0.62;
          const p3: Pt = [p2[0] + n[0] * L, p2[1] + n[1] * L];
          addTrace([p0, p1, p2, p3], 0.12);
          addVia(p3[0] + n[0] * 0.1, p3[1] + n[1] * 0.1, 0.42);
        }
      }
    });
  }

  // QFN pads (perimeter) + exposed thermal pad hidden below
  const qfnPads = (p: Part) => {
    const N = p.pins!;
    const pitch = p.pitch!;
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < N; i++) {
        const s = (i - (N - 1) / 2) * pitch;
        const half = p.w / 2;
        const along = side % 2 === 1;
        const nx = side === 1 ? 1 : side === 3 ? -1 : 0;
        const ny = side === 0 ? -1 : side === 2 ? 1 : 0;
        const cx = p.x + nx * (half - 0.1) + (along ? 0 : s);
        const cy = p.y + ny * (half - 0.1) + (along ? s : 0);
        addPad({ x: cx, y: cy, w: along ? 0.7 : pitch * 0.55, h: along ? pitch * 0.55 : 0.7, finish: "solder" });
        if ((i + side) % 2 === 0) {
          const ex = cx + nx * 0.85;
          const ey = cy + ny * 0.85;
          if (viaFree(ex + nx * 0.2, ey + ny * 0.2, 0.4)) {
            addTrace([[cx + nx * 0.35, cy + ny * 0.35], [ex, ey]], 0.12);
            addVia(ex + nx * 0.2, ey + ny * 0.2, 0.4);
          }
        }
      }
    }
  };

  // B2B connector pads + fan-out
  const b2bPads = (p: Part, fanBottomToBus: boolean) => {
    const N = p.pins!;
    const pitch = p.pitch!;
    const vertical = p.rot === 90;
    const longHalf = (vertical ? p.h : p.w) / 2;
    const shortHalf = (vertical ? p.w : p.h) / 2;
    const span = (N - 1) * pitch;
    const pins: Pt[][] = [[], []];
    for (let row = 0; row < 2; row++) {
      const sideSign = row === 0 ? -1 : 1;
      for (let i = 0; i < N; i++) {
        const a = -span / 2 + i * pitch;
        const b = sideSign * (shortHalf + 0.12);
        const x = vertical ? p.x + b : p.x + a;
        const y = vertical ? p.y + a : p.y + b;
        addPad({ x, y, w: vertical ? 0.85 : 0.22, h: vertical ? 0.22 : 0.85, finish: "solder" });
        pins[row].push([x, y]);
      }
    }
    // hold-down brackets
    for (const e of [-1, 1]) {
      const a = e * (longHalf + 0.35);
      const x = vertical ? p.x : p.x + a;
      const y = vertical ? p.y + a : p.y;
      addPad({ x, y, w: vertical ? shortHalf * 2 + 0.6 : 0.9, h: vertical ? 0.9 : shortHalf * 2 + 0.6, finish: "solder" });
    }
    // fan-out to staggered microvias
    pins.forEach((row, ri) => {
      if (fanBottomToBus && ri === 1) return;
      const sideSign = ri === 0 ? -1 : 1;
      row.forEach(([x, y], i) => {
        const d = 0.62 + (i % 2) * 0.55;
        const vx = vertical ? x + sideSign * (0.45 + d) : x;
        const vy = vertical ? y : y + sideSign * (0.45 + d);
        if (!onBoard(vx, vy, 0.6)) return;
        addTrace([[x, y], [vx, vy]], 0.1, "signal", 0.08);
        addVia(vx, vy, 0.38);
      });
    });
    return pins;
  };

  const j1Pins = b2bPads(j1, true);
  b2bPads(j2, false);
  b2bPads(j3, false);
  [pmic, u7, u10, u13].forEach(qfnPads);

  // J1 bottom row: staircase into a 34-trace bus that dives under the SoC.
  {
    const row = j1Pins[1];
    const n = row.length;
    const pitchBus = 0.24;
    const yStart = row[0][1] + 0.42;
    const top = yStart + 0.7;
    row.forEach(([x], i) => {
      const k = n - 1 - i; // rightmost pin turns first
      const hy = top + k * pitchBus;
      const c = 0.45;
      addTrace([[x, yStart - 0.42], [x, hy - c], [x + c, hy], [soc.x - soc.w / 2 + 0.8, hy]], 0.1, "signal", 0.06);
    });
  }

  // Shield fence (solder line) + stitching vias around it
  {
    const s = shield;
    const x0 = s.x - s.w / 2;
    const x1 = s.x + s.w / 2;
    const y0 = s.y - s.h / 2;
    const y1 = s.y + s.h / 2;
    const t = 0.45;
    shieldFence.push({ x0, y0, x1, y1: y0 + t }, { x0, y0: y1 - t, x1, y1 }, { x0, y0, x1: x0 + t, y1 }, { x0: x1 - t, y0, x1, y1 });
    for (const r of shieldFence) addPad({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, w: r.x1 - r.x0 + 0.1, h: r.y1 - r.y0 + 0.1, finish: "solder" });
  }

  // -------------------------------------------------------------------------
  // Authored routing: buses, power rails, RF lines

  const bus = (center: Pt[], n: number, pitch: number, w: number, kind: TraceKind = "signal", startVias = false) => {
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * pitch;
      const pts = offsetPolyline(center, off);
      if (startVias) {
        // stagger the launch vias in three rows so they never touch
        const dx = center[1][0] - center[0][0];
        const dy = center[1][1] - center[0][1];
        const l = Math.hypot(dx, dy);
        const back = (k % 3) * 0.55 + 0.3;
        const vx = pts[0][0] - (dx / l) * back;
        const vy = pts[0][1] - (dy / l) * back;
        pts.unshift([vx, vy]);
        addVia(vx, vy, 0.42);
      }
      addTrace(pts, w, kind, 0.06);
    }
  };

  // SoC -> NAND (16 lanes)
  bus(
    [
      [51, 36.5],
      [51, 46.2],
      [55.4, 50.6],
      [86.6, 50.6],
      [89.6, 53.6],
      [93.0, 57.0],
    ],
    16,
    0.24,
    0.1,
  );

  // Inner-layer escape near J2 -> NAND (12 lanes, launched from staggered vias)
  bus(
    [
      [135.2, 31.2],
      [135.2, 40.4],
      [131.6, 44.0],
      [102.6, 44.0],
      [99.6, 47.0],
      [99.6, 54.0],
    ],
    12,
    0.24,
    0.1,
    "signal",
    true,
  );

  // QFP right-side vias -> PMIC area (8 lanes, dropping to an inner layer before the dense cluster)
  {
    const center: Pt[] = [
      [90.2, 37.5],
      [90.2, 31.2],
      [95.4, 26.0],
      [103.4, 26.0],
    ];
    bus(center, 8, 0.24, 0.1, "signal", true);
    for (let k = 0; k < 8; k++) {
      const off = (k - 3.5) * 0.24;
      const end = offsetPolyline(center, off);
      const [x, y] = end[end.length - 1];
      const vx = x + 0.35 + (k % 3) * 0.55;
      traces.push({ pts: [[x, y], [vx, y]], w: 0.1, kind: "signal" });
      addVia(vx, y, 0.42);
    }
  }

  // Power rails PMIC -> SoC
  const rail: Pt[] = [
    [119.6, 15.4],
    [117.2, 13.0],
    [63.6, 13.0],
    [57.6, 19.0],
    [52.6, 24.0],
    [51.2, 25.4],
  ];
  addTrace(rail, 0.75, "power", 0.22);
  addTrace(offsetPolyline(rail, 1.05), 0.45, "power", 0.2);

  // Length-matched serpentines (DDR-style)
  [53.9, 55.9].forEach((y, i) => {
    const pts = serpentine(70.4 + i * 0.6, 86.4, y, 0.95, 1.3);
    addVia(pts[0][0] - 0.3, y, 0.42);
    addVia(pts[pts.length - 1][0] + 0.3, y, 0.42);
    addTrace(pts, 0.1, "signal", 0.08);
  });

  // RF coplanar lines from the shield to antenna spring contacts, with via fences
  const rfLine = (pts: Pt[], feed: Pad) => {
    addTrace(pts, 0.32, "rf", 0.35);
    addPad(feed);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const l = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / l;
      const ny = (bx - ax) / l;
      const steps = Math.floor(l / 0.85);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        for (const side of [-1, 1]) {
          const vx = ax + (bx - ax) * t + nx * side * 0.85;
          const vy = ay + (by - ay) * t + ny * side * 0.85;
          if (viaFree(vx, vy, 0.4)) addVia(vx, vy, 0.4);
        }
      }
    }
  };
  rfLine(
    [
      [shield.x + shield.w / 2 - 0.4, 56],
      [53.6, 56],
      [55.6, 58],
      [55.6, 70.6],
      [51.2, 75],
      [50.4, 75.8],
    ],
    { x: 49.5, y: 76.6, w: 2.2, h: 1.6, finish: "enig" },
  );
  rfLine(
    [
      [shield.x - shield.w / 2 + 0.4, 55.4],
      [14.2, 55.4],
      [10.6, 59],
      [5.6, 59],
    ],
    { x: 4.4, y: 59, w: 1.6, h: 2.3, finish: "enig" },
  );

  // Battery spring contacts on the left edge + their wide straps to via clusters
  [20.4, 23.6, 26.8].forEach((y) => {
    addPad({ x: 3.4, y, w: 2.2, h: 1.7, finish: "enig" });
    addTrace([[4.4, y], [8.4, y]], 1.0, "power", 0.25);
    for (let k = 0; k < 3; k++) addVia(7.2 + k * 0.62, y + (k % 2 ? 0.28 : -0.28), 0.45);
  });

  // Fiducials
  ([[9.6, 11.2], [142.4, 12.6], [90.6, 76.4]] as Pt[]).forEach(([x, y]) => {
    fiducials.push([x, y]);
    occ.markCircle(x, y, 1.3);
    padOcc.markCircle(x, y, 1.1);
  });

  // Copper islands (split planes) under the PMIC output stage
  islands.push([
    [121.6, 14.8],
    [128.4, 14.8],
    [128.4, 27.6],
    [121.6, 27.6],
  ]);
  islands.push([
    [118.4, 15.2],
    [121.0, 15.2],
    [121.0, 27.4],
    [118.4, 27.4],
  ]);
  islands.push([
    [97.4, 19.6],
    [102.8, 19.6],
    [102.8, 23.8],
    [97.4, 23.8],
  ]);

  // Pads for discrete parts (inductors, tantalums, crystals)
  for (const p of parts) {
    if (p.kind === "inductor") {
      const vertical = p.h > p.w;
      const L = vertical ? p.h : p.w;
      const W = vertical ? p.w : p.h;
      for (const e of [-1, 1]) {
        const a = e * (L / 2 - 0.25);
        addPad({ x: vertical ? p.x : p.x + a, y: vertical ? p.y + a : p.y, w: vertical ? W * 0.95 : 0.9, h: vertical ? 0.9 : W * 0.95, finish: "solder" });
      }
    } else if (p.kind === "tantalum") {
      const vertical = p.rot === 90;
      const L = vertical ? p.h : p.w;
      const W = vertical ? p.w : p.h;
      for (const e of [-1, 1]) {
        const a = e * (L / 2 - 0.3);
        addPad({ x: vertical ? p.x : p.x + a, y: vertical ? p.y + a : p.y, w: vertical ? W * 0.75 : 1.1, h: vertical ? 1.1 : W * 0.75, finish: "solder" });
      }
    } else if (p.kind === "crystal") {
      for (const ex of [-1, 1])
        for (const ey of [-1, 1])
          addPad({ x: p.x + ex * (p.w / 2 - 0.4), y: p.y + ey * (p.h / 2 - 0.35), w: 0.75, h: 0.6, finish: "solder" });
    }
  }

  // -------------------------------------------------------------------------
  // Passive arrays

  const chipFoot = (size: ChipSize, rot: 0 | 90) => {
    const d = CHIP_DIMS[size];
    const a = (d.cc + d.padL) / 2 + 0.06;
    const b = Math.max(d.W, d.padW) / 2 + 0.06;
    return rot === 0 ? { hx: a, hy: b } : { hx: b, hy: a };
  };

  const kindFor = (bias = 0.65): ChipKind => {
    const r = rnd();
    if (r < bias) return "C";
    if (r < 0.95) return "R";
    return "F";
  };

  const tryChip = (x: number, y: number, size: ChipSize, rot: 0 | 90, kind?: ChipKind): Chip | null => {
    const { hx, hy } = chipFoot(size, rot);
    if (!onBoard(x - hx, y - hy, 0.9) || !onBoard(x + hx, y + hy, 0.9) || !onBoard(x - hx, y + hy, 0.9) || !onBoard(x + hx, y - hy, 0.9)) return null;
    if (!occ.freeRect(x - hx, y - hy, x + hx, y + hy)) return null;
    const c: Chip = { x, y, size, rot, kind: kind ?? kindFor(), tone: rnd() };
    chips.push(c);
    occ.markRect(x - hx, y - hy, x + hx, y + hy);
    const d = CHIP_DIMS[size];
    for (const e of [-1, 1]) {
      const px = rot === 0 ? x + (e * d.cc) / 2 : x;
      const py = rot === 0 ? y : y + (e * d.cc) / 2;
      const pw = rot === 0 ? d.padL : d.padW;
      const ph = rot === 0 ? d.padW : d.padL;
      pads.push({ x: px, y: py, w: pw, h: ph, finish: "solder" });
      padOcc.markRect(px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2);
    }
    padOcc.markRect(x - (rot === 0 ? d.L : d.W) / 2, y - (rot === 0 ? d.W : d.L) / 2, x + (rot === 0 ? d.L : d.W) / 2, y + (rot === 0 ? d.W : d.L) / 2);
    return c;
  };

  const row = (x0: number, y0: number, dx: number, dy: number, n: number, size: ChipSize, rot: 0 | 90, skip = 0, kind?: ChipKind) => {
    for (let i = 0; i < n; i++) {
      if (rnd() < skip) continue;
      tryChip(x0 + dx * i, y0 + dy * i, size, rot, kind);
    }
  };

  /**
   * Ordered array; pitches are given along / across the part's long axis.
   * Depopulation is structured (whole rows dropped, gaps in short runs) so
   * fields read as designed arrays rather than random scatter.
   */
  const grid = (x0: number, y0: number, x1: number, y1: number, along: number, across: number, size: ChipSize, rot: 0 | 90, skip = 0.2, bias = 0.65) => {
    const dx = rot === 0 ? along : across;
    const dy = rot === 0 ? across : along;
    for (let y = y0; y <= y1 + 1e-6; y += dy) {
      if (rnd() < skip * 0.3) continue; // drop a whole row now and then
      let gap = false;
      // one kind per short run, like real decoupling / pull-up banks
      let runKind = kindFor(bias);
      let runLeft = 2 + Math.floor(rnd() * 4);
      for (let x = x0; x <= x1 + 1e-6; x += dx) {
        gap = gap ? rnd() < 0.55 : rnd() < skip * 0.4;
        if (runLeft-- <= 0) {
          runKind = kindFor(bias);
          runLeft = 2 + Math.floor(rnd() * 4);
        }
        if (gap) continue;
        tryChip(x, y, size, rot, runKind);
      }
    }
  };

  // SoC decoupling: double rows of 0201 on every side
  row(soc.x - 6.6, soc.y - 7.9, 0.6, 0, 23, "0201", 90, 0.05, "C");
  row(soc.x - 6.3, soc.y - 8.95, 0.6, 0, 22, "0201", 90, 0.3, "C");
  row(soc.x - 6.6, soc.y + 7.9, 0.6, 0, 23, "0201", 90, 0.05, "C");
  row(soc.x - 6.3, soc.y + 8.95, 0.6, 0, 22, "0201", 90, 0.3, "C");
  row(soc.x - 7.95, soc.y - 6.6, 0, 0.6, 23, "0201", 0, 0.05, "C");
  row(soc.x + 7.95, soc.y - 6.6, 0, 0.6, 23, "0201", 0, 0.05, "C");

  // NAND decaps
  row(nand.x - 6.4, nand.y - 5.8, 0, 0.6, 20, "0201", 0, 0.15, "C");
  row(nand.x + 6.4, nand.y - 5.8, 0, 0.6, 20, "0201", 0, 0.25, "C");

  // QFP corner decaps (in the gaps between the fan-outs, clear of the silk corner marks)
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as Pt[]) {
    const cy = qfp.y + sy * (sy < 0 ? 8.2 : 8.4);
    const x0 = sx < 0 ? qfp.x - 12.1 : qfp.x + 8.9;
    row(x0, cy, 1.6, 0, 3, "0402", 0, 0, "C");
    row(sx < 0 ? qfp.x - 11.0 : qfp.x + 8.8, cy + sy * 1.0, 1.1, 0, 3, "0201", 0, 0.2);
  }

  // PMIC: the dense cluster (region D)
  grid(105.9, 15.4, 110.4, 27.9, 1.02, 0.6, "0201", 90, 0.06, 0.55);
  row(111.4, 17.1, 0.78, 0, 8, "0402", 90, 0.0, "C");
  row(111.1, 15.55, 0.62, 0, 10, "0201", 90, 0.15);
  row(111.4, 26.2, 0.78, 0, 8, "0402", 90, 0.0, "C");
  row(111.1, 27.75, 0.62, 0, 10, "0201", 90, 0.15);
  row(119.7, 16.0, 0, 1.32, 9, "0603", 0, 0.0, "C");
  row(127.9, 15.9, 0, 0.95, 13, "0402", 0, 0.1, "C");
  // around U6 / U13
  grid(131.4, 16.4, 138.0, 24.4, 1.15, 0.7, "0201", 0, 0.35);
  grid(123.0, 4.6, 140.0, 12.4, 1.7, 0.95, "0402", 0, 0.4);

  // J1 filter / ESD array above the connector
  row(17.2, 19.0, 0.6, 0, 24, "0201", 90, 0.08);
  row(17.5, 17.8, 0.9, 0, 15, "0201", 90, 0.35);

  // Shield surroundings
  row(23.2, 66.0, 0.9, 0, 29, "0201", 90, 0.35);
  row(23.6, 67.4, 1.6, 0, 16, "0402", 0, 0.4);

  // Filler arrays in the remaining free zones (ordered grids, randomly depopulated)
  grid(9.0, 7.0, 27.0, 17.0, 1.75, 1.0, "0402", 0, 0.4);
  grid(33.0, 6.0, 62.0, 11.2, 1.15, 0.72, "0201", 0, 0.42);
  grid(36.0, 15.4, 56.0, 21.0, 1.15, 0.72, "0201", 90, 0.45);
  grid(68.0, 15.4, 96.0, 21.6, 1.75, 1.0, "0402", 0, 0.45);
  grid(95.0, 3.5, 121.0, 11.0, 1.75, 1.0, "0402", 0, 0.42);
  grid(3.5, 13.5, 16.0, 30.0, 1.15, 0.72, "0201", 0, 0.45);
  grid(3.5, 33.0, 20.0, 44.0, 1.75, 1.0, "0402", 0, 0.45);
  grid(16.0, 46.0, 21.5, 53.0, 1.15, 0.72, "0201", 90, 0.4);
  grid(3.5, 62.0, 21.0, 77.0, 1.75, 1.0, "0402", 0, 0.45);
  grid(22.0, 69.0, 56.0, 77.0, 1.15, 0.72, "0201", 0, 0.5);
  grid(58.0, 57.0, 88.0, 71.5, 1.15, 0.72, "0201", 90, 0.45);
  grid(102.5, 61.6, 140.0, 68.4, 1.75, 1.0, "0402", 0, 0.4);
  grid(104.0, 29.6, 134.0, 42.0, 1.15, 0.72, "0201", 0, 0.42);
  grid(132.0, 44.0, 147.0, 58.0, 1.75, 1.0, "0402", 0, 0.45);
  grid(143.0, 14.0, 147.6, 28.0, 1.15, 0.72, "0201", 90, 0.4);
  grid(88.0, 63.0, 101.0, 72.0, 1.15, 0.72, "0201", 0, 0.5);

  // -------------------------------------------------------------------------
  // Dog-bone escapes for passives (pad -> short stub -> microvia)
  for (const c of chips) {
    if (rnd() > 0.5) continue;
    const d = CHIP_DIMS[c.size];
    const e = rnd() < 0.5 ? -1 : 1;
    const along = rnd() < 0.55;
    const px = c.rot === 0 ? c.x + (e * d.cc) / 2 : c.x;
    const py = c.rot === 0 ? c.y : c.y + (e * d.cc) / 2;
    let dx = 0;
    let dy = 0;
    if (along) {
      if (c.rot === 0) dx = e;
      else dy = e;
    } else {
      const s = rnd() < 0.5 ? -1 : 1;
      if (c.rot === 0) dy = s;
      else dx = s;
    }
    const len = d.padL / 2 + 0.38;
    const vx = px + dx * len;
    const vy = py + dy * len;
    if (!viaFree(vx, vy, 0.4)) continue;
    traces.push({ pts: [[px, py], [vx, vy]], w: 0.12, kind: "signal" });
    addVia(vx, vy, 0.4);
  }

  // Edge stitching (ground ring) along the board perimeter
  const edgeVias = (x0: number, y0: number, x1: number, y1: number, pitch: number) => {
    const l = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(l / pitch);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (onBoard(x, y, 0.6) && occ.freeCircle(x, y, 0.32)) addVia(x, y, 0.42);
    }
  };
  edgeVias(6.5, 1.2, BOARD_W - 6.5, 1.2, 1.1);
  edgeVias(1.2, 7, 1.2, BOARD_H - 7, 1.1);
  edgeVias(BOARD_W - 1.2, 7, BOARD_W - 1.2, 58.6, 1.1);
  edgeVias(6.5, BOARD_H - 1.2, 56.6, BOARD_H - 1.2, 1.1);
  edgeVias(85.4, BOARD_H - 1.2, 138.6, BOARD_H - 1.2, 1.1);
  edgeVias(59.4, 71.8, 82.6, 71.8, 1.1);
  // around the shield fence (double, staggered)
  {
    const s = shield;
    const x0 = s.x - s.w / 2 - 0.75;
    const x1 = s.x + s.w / 2 + 0.75;
    const y0 = s.y - s.h / 2 - 0.75;
    const y1 = s.y + s.h / 2 + 0.75;
    edgeVias(x0, y0, x1, y0, 0.9);
    edgeVias(x0, y1, x1, y1, 0.9);
    edgeVias(x0, y0, x0, y1, 0.9);
    edgeVias(x1, y0, x1, y1, 0.9);
  }
  // mounting-hole via rings
  for (const h of MOUNTING_HOLES) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = h.x + Math.cos(a) * (h.ring + 0.55);
      const y = h.y + Math.sin(a) * (h.ring + 0.55);
      if (x > 0.8 && y > 0.8 && x < BOARD_W - 0.8 && y < BOARD_H - 0.8) {
        vias.push({ x, y, d: 0.42 });
        occ.markCircle(x, y, 0.32);
      }
    }
  }
  // sparse ground stitching in the open pour
  for (let y = 2.4; y < BOARD_H - 2; y += 1.45) {
    for (let x = 2.4; x < BOARD_W - 2; x += 1.45) {
      if (rnd() > 0.32) continue;
      const jx = x + (rnd() - 0.5) * 0.4;
      const jy = y + (rnd() - 0.5) * 0.4;
      if (viaFree(jx, jy, 0.42)) addVia(jx, jy, 0.42);
    }
  }

  // -------------------------------------------------------------------------
  // Silkscreen

  const textFits = (t: SilkText) => {
    const w = t.text.length * t.size * 0.62;
    const h = t.size;
    const x0 = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
    const vertical = t.rot && Math.abs(t.rot) > 0.1;
    const rx0 = vertical ? t.x - h / 2 : x0;
    const ry0 = vertical ? t.y - w / 2 : t.y - h / 2;
    const rx1 = vertical ? t.x + h / 2 : x0 + w;
    const ry1 = vertical ? t.y + w / 2 : t.y + h / 2;
    if (!onBoard(rx0, ry0, 0.6) || !onBoard(rx1, ry1, 0.6)) return false;
    if (!padOcc.freeRect(rx0 - 0.08, ry0 - 0.08, rx1 + 0.08, ry1 + 0.08)) return false;
    if (!textOcc.freeRect(rx0 - 0.15, ry0 - 0.15, rx1 + 0.15, ry1 + 0.15)) return false;
    textOcc.markRect(rx0, ry0, rx1, ry1);
    return true;
  };
  const addText = (t: SilkText, force = false) => {
    if (textFits(t)) {
      silkText.push(t);
      return true;
    }
    if (force) {
      silkText.push(t);
      // still reserve the space so later designators keep clear of it
      const w = t.text.length * t.size * 0.62;
      const x0 = t.align === "center" ? t.x - w / 2 : t.align === "right" ? t.x - w : t.x;
      textOcc.markRect(x0 - 0.1, t.y - t.size / 2 - 0.1, x0 + w + 0.1, t.y + t.size / 2 + 0.1);
      return true;
    }
    return false;
  };

  const corners = (x: number, y: number, hw: number, hh: number, leg: number, w = 0.13) => {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const cx = x + sx * hw;
      const cy = y + sy * hh;
      silkPaths.push({ pts: [[cx - sx * leg, cy], [cx, cy], [cx, cy - sy * leg]], w });
    }
  };

  for (const p of parts) {
    const hw = p.w / 2;
    const hh = p.h / 2;
    switch (p.kind) {
      case "bga":
        corners(p.x, p.y, hw + 0.45, hh + 0.45, 1.6);
        silkPaths.push({ pts: [[p.x - hw - 0.45, p.y - hh + 0.9], [p.x - hw + 0.9 - 0.45, p.y - hh - 0.45], [p.x - hw - 0.45, p.y - hh - 0.45]], w: 0.1, closed: true, fill: true });
        break;
      case "qfp":
        corners(p.x, p.y, 7.95, 7.95, 0.9);
        {
          // pin-1 dot in the free corner between the two lead rows
          const pts: Pt[] = [];
          for (let k = 0; k < 16; k++) pts.push([p.x - 6.85 + Math.cos((k / 16) * Math.PI * 2) * 0.28, p.y - 6.85 + Math.sin((k / 16) * Math.PI * 2) * 0.28]);
          silkPaths.push({ pts, w: 0, closed: true, fill: true });
        }
        break;
      case "qfn":
        corners(p.x, p.y, hw + 0.45, hh + 0.45, 0.6, 0.11);
        silkPaths.push({ pts: [[p.x - hw - 0.7, p.y - hh - 0.25], [p.x - hw - 0.25, p.y - hh - 0.25], [p.x - hw - 0.7, p.y - hh + 0.2]], w: 0.08, closed: true, fill: true });
        break;
      case "wlcsp":
        corners(p.x, p.y, hw + 0.35, hh + 0.35, 0.45, 0.1);
        break;
      case "b2b": {
        const vertical = p.rot === 90;
        const ex = vertical ? hw + 0.85 : hw + 1.05;
        const ey = vertical ? hh + 1.05 : hh + 0.85;
        silkPaths.push({ pts: [[p.x - ex, p.y - ey], [p.x + ex, p.y - ey], [p.x + ex, p.y + ey], [p.x - ex, p.y + ey]], closed: true, w: 0.12 });
        break;
      }
      case "crystal":
      case "inductor":
        silkPaths.push({ pts: [[p.x - hw - 0.3, p.y - hh - 0.3], [p.x + hw + 0.3, p.y - hh - 0.3]], w: 0.11 });
        silkPaths.push({ pts: [[p.x - hw - 0.3, p.y + hh + 0.3], [p.x + hw + 0.3, p.y + hh + 0.3]], w: 0.11 });
        break;
      case "tantalum": {
        const vertical = p.rot === 90;
        silkPaths.push({ pts: [[p.x - hw - 0.3, p.y - hh - 0.3], [p.x + hw + 0.3, p.y - hh - 0.3], [p.x + hw + 0.3, p.y + hh + 0.3], [p.x - hw - 0.3, p.y + hh + 0.3]], closed: true, w: 0.11 });
        // polarity bar on the anode side
        if (vertical) silkPaths.push({ pts: [[p.x - hw - 0.3, p.y - hh - 0.55], [p.x + hw + 0.3, p.y - hh - 0.55]], w: 0.22 });
        else silkPaths.push({ pts: [[p.x - hw - 0.55, p.y - hh - 0.3], [p.x - hw - 0.55, p.y + hh + 0.3]], w: 0.22 });
        break;
      }
      default:
        break;
    }
  }
  // silk outlines block designators
  for (const sp of silkPaths) {
    for (let i = 0; i < sp.pts.length - 1; i++) textOcc.markSegment(sp.pts[i][0], sp.pts[i][1], sp.pts[i + 1][0], sp.pts[i + 1][1], sp.w / 2 + 0.12);
    if (sp.closed && sp.pts.length > 2) {
      const a = sp.pts[sp.pts.length - 1];
      const b = sp.pts[0];
      textOcc.markSegment(a[0], a[1], b[0], b[1], sp.w / 2 + 0.12);
    }
  }
  for (const p of parts) {
    const hw = p.w / 2;
    const hh = p.h / 2;
    if (p.silk && p.silk !== "none") {
      const size = p.kind === "bga" || p.kind === "b2b" ? 1.0 : 0.72;
      const gap = 0.75 + size * 0.5;
      const pos = {
        below: [p.x, p.y + hh + gap, "center"],
        above: [p.x, p.y - hh - gap, "center"],
        left: [p.x - hw - gap - 0.2, p.y, "right"],
        right: [p.x + hw + gap - 0.2, p.y, "left"],
      } as const;
      const order = [p.silk, "below", "above", "right", "left"] as const;
      for (const o of order) {
        const [x, y, align] = pos[o];
        if (addText({ text: p.ref, x, y, size, align, weight: 600 })) break;
      }
    }
  }
  // Region-defining designators that must always be legible
  {
    const tries: Array<[number, number, CanvasTextAlign]> = [
      [qfp.x - 8.3, qfp.y - 9.2, "right"],
      [qfp.x - 10.3, qfp.y, "right"],
      [qfp.x - 9.2, qfp.y + 9.5, "left"],
    ];
    if (!tries.some(([x, y, align]) => addText({ text: "U3", x, y, size: 0.95, align, weight: 600 }))) {
      addText({ text: "U3", x: tries[1][0], y: tries[1][1], size: 0.95, align: "right", weight: 600 }, true);
    }
  }
  addText({ text: "U4", x: pmic.x - 3.2, y: pmic.y + 3.9, size: 0.7, align: "left", weight: 600 });
  addText({ text: "SH1", x: shield.x - shield.w / 2 + 0.1, y: shield.y - shield.h / 2 - 1.15, size: 0.8, align: "left", weight: 600 });

  // Test-point designators
  testPoints.forEach((tp, i) => {
    const below = i < 5 || i === 10;
    const right = i >= 10;
    addText(
      right
        ? { text: tp.ref, x: tp.x + 1.25, y: tp.y, size: 0.62, align: "left", weight: 600 }
        : { text: tp.ref, x: tp.x, y: tp.y + (below ? -1.05 : 1.05), size: 0.62, align: "center", weight: 600 },
      true,
    );
  });
  addText({ text: "VERIFY ZONE", x: win.x0, y: win.y1 + 0.85, size: 0.6, align: "left", weight: 500 }, true);
  silkPaths.push({ pts: [[win.x0 - 0.35, win.y0 - 0.35], [win.x1 + 0.35, win.y0 - 0.35], [win.x1 + 0.35, win.y1 + 0.35], [win.x0 - 0.35, win.y1 + 0.35]], closed: true, w: 0.1 });

  // Passive designators where there is space
  let cn = 12;
  let rn = 7;
  let fn = 2;
  for (const c of chips) {
    const ref = c.kind === "C" ? `C${(cn += 1 + Math.floor(rnd() * 3))}` : c.kind === "R" ? `R${(rn += 1 + Math.floor(rnd() * 2))}` : `FL${(fn += 1)}`;
    if (rnd() > 0.4) continue;
    const d = CHIP_DIMS[c.size];
    const size = c.size === "0201" ? 0.42 : 0.5;
    const off = (c.rot === 0 ? d.W : d.L) / 2 + 0.25 + size / 2;
    const offs: Array<[number, number, CanvasTextAlign]> =
      c.rot === 0
        ? [
            [0, -off, "center"],
            [0, off, "center"],
          ]
        : [
            [-(d.W / 2 + 0.3), 0, "right"],
            [d.W / 2 + 0.3, 0, "left"],
          ];
    for (const [ox, oy, align] of offs) {
      if (addText({ text: ref, x: c.x + ox, y: c.y + oy, size, align, weight: 500 })) break;
    }
  }

  // Board identity block
  addText({ text: "BGL-A2614", x: 103.0, y: 72.0, size: 1.5, align: "left", weight: 600 }, true);
  addText({ text: "REV C", x: 116.6, y: 72.0, size: 1.1, align: "left", weight: 600 }, true);
  addText({ text: "820-02614-C  10L HDI  ANYLAYER", x: 103.0, y: 74.3, size: 0.62, align: "left", weight: 500 }, true);
  addText({ text: "26/41   94V-0   E482117", x: 103.0, y: 75.6, size: 0.62, align: "left", weight: 500 }, true);
  addText({ text: "BOARDGUARD REF. ASSY", x: 103.0, y: 76.9, size: 0.62, align: "left", weight: 500 }, true);
  addText({ text: "BATT", x: 3.2, y: 18.3, size: 0.65, align: "center", weight: 600 }, true);
  addText({ text: "+", x: 5.6, y: 20.4, size: 0.8, align: "center", weight: 600 }, true);
  addText({ text: "-", x: 5.6, y: 26.8, size: 0.8, align: "center", weight: 600 }, true);
  addText({ text: "ANT1", x: 49.5, y: 74.9, size: 0.6, align: "center", weight: 600 }, true);
  addText({ text: "ANT0", x: 4.4, y: 56.9, size: 0.6, align: "center", weight: 600 }, true);
  textOcc.markRect(103, 70.5, 128, 77.5);

  // Data-matrix style traceability code
  {
    const x0 = 128.6;
    const y0 = 69.6;
    const m = 0.24;
    const n = 14;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const border = c === 0 || r === n - 1;
        const clock = (r === 0 && c % 2 === 0) || (c === n - 1 && r % 2 === 1);
        if (border || clock || rnd() < 0.45) {
          const x = x0 + c * m;
          const y = y0 + r * m;
          silkPaths.push({ pts: [[x, y], [x + m, y], [x + m, y + m], [x, y + m]], closed: true, fill: true, w: 0 });
        }
      }
    }
  }

  return { parts, chips, pads, traces, vias, silkText, silkPaths, windows, islands, fiducials, shieldFence, testPoints };
}

let cached: BoardLayout | null = null;

export function getBoardLayout(): BoardLayout {
  if (!cached) {
    const t0 = performance.now();
    cached = buildLayout();
    performance.measure("board-explorer:layout", { start: t0, end: performance.now() });
  }
  return cached;
}
