/**
 * Derives every repeated 3D element (passive bodies, terminations, solder
 * fillets, gull-wing leads, solder balls, small metal parts) from the layout.
 * All values are in board millimetres; x = board x, y = height, z = board y.
 */
import * as THREE from "three";
import { CHIP_DIMS, type BoardLayout, type Part } from "../model/layout";

export interface Xf {
  p: [number, number, number];
  s: [number, number, number];
  /** rotation about Y (radians) */
  ry?: number;
  color?: THREE.Color;
}

export interface InstanceSets {
  chipBodies: Xf[];
  chipTerms: Xf[];
  fillets: Xf[];
  leads: Xf[];
  balls: Xf[];
  metal: Xf[];
  gold: Xf[];
  underfill: Xf[];
}

// MLCC dielectric tints seen on real boards: tan, honey, grey-brown.
const MLCC = ["#a8885f", "#9b7a52", "#b8996d", "#8a7358", "#a39079", "#b09068"].map((c) => new THREE.Color(c));
const RES = new THREE.Color("#1b1b1c");
const FERRITE = new THREE.Color("#34363a");

/** rotation that maps local +x (outward) onto the board direction (nx, nz) */
const ryFor = (nx: number, nz: number) => Math.atan2(-nz, nx);

export function buildInstances(layout: BoardLayout): InstanceSets {
  const out: InstanceSets = { chipBodies: [], chipTerms: [], fillets: [], leads: [], balls: [], metal: [], gold: [], underfill: [] };

  // --- chip passives
  for (const c of layout.chips) {
    const d = CHIP_DIMS[c.size];
    const H = c.kind === "R" ? d.Hr : d.H;
    const ry = c.rot === 0 ? 0 : Math.PI / 2;
    const color = c.kind === "C" ? MLCC[Math.floor(c.tone * MLCC.length) % MLCC.length] : c.kind === "R" ? RES : FERRITE;
    out.chipBodies.push({ p: [c.x, 0.02, c.y], s: [d.L - d.term * 2 + 0.02, H - 0.01, d.W - 0.01], ry, color });
    const ax = c.rot === 0 ? 1 : 0;
    const az = c.rot === 0 ? 0 : 1;
    const filletLen = Math.max(0.08, ((d.cc + d.padL) / 2 - d.L / 2) * 0.92);
    for (const e of [-1, 1]) {
      const off = d.L / 2 - d.term / 2;
      out.chipTerms.push({ p: [c.x + ax * e * off, 0.015, c.y + az * e * off], s: [d.term, H + 0.012, d.W + 0.02], ry });
      out.fillets.push({
        p: [c.x + ax * e * (d.L / 2), 0.0, c.y + az * e * (d.L / 2)],
        s: [filletLen, H * 0.55, d.W * 0.96],
        ry: ryFor(ax * e, az * e),
      });
    }
  }

  for (const p of layout.parts) {
    switch (p.kind) {
      case "qfp":
        qfp(p, out);
        break;
      case "qfn":
        qfn(p, out);
        break;
      case "bga":
        bga(p, out);
        break;
      case "wlcsp":
        wlcsp(p, out);
        break;
      case "b2b":
        b2b(p, out);
        break;
      case "inductor":
        endTerminated(p, out, 0.3, 0.62, 0.95);
        break;
      case "tantalum":
        endTerminated(p, out, 0.14, 0.55, 0.62);
        break;
      case "crystal":
        for (const ex of [-1, 1])
          for (const ez of [-1, 1]) {
            out.fillets.push({ p: [p.x + ex * (p.w / 2), 0, p.y + ez * (p.h / 2 - 0.35)], s: [0.16, 0.14, 0.5], ry: ryFor(ex, 0) });
          }
        break;
      default:
        break;
    }
  }
  return out;
}

const SIDES: Array<{ n: [number, number]; t: [number, number] }> = [
  { n: [0, -1], t: [1, 0] },
  { n: [1, 0], t: [0, 1] },
  { n: [0, 1], t: [-1, 0] },
  { n: [-1, 0], t: [0, -1] },
];

function qfp(p: Part, out: InstanceSets) {
  const N = p.pins ?? 20;
  const pitch = p.pitch ?? 0.5;
  const half = p.w / 2;
  for (const { n, t } of SIDES) {
    const ry = ryFor(n[0], n[1]);
    for (let i = 0; i < N; i++) {
      const s = (i - (N - 1) / 2) * pitch;
      const bx = p.x + n[0] * half + t[0] * s;
      const bz = p.y + n[1] * half + t[1] * s;
      out.leads.push({ p: [bx, 0, bz], s: [1, 1, 1], ry });
      // toe and heel fillets
      out.fillets.push({ p: [bx + n[0] * 1.0, 0, bz + n[1] * 1.0], s: [0.3, 0.13, 0.24], ry });
      out.fillets.push({ p: [bx + n[0] * 0.6, 0, bz + n[1] * 0.6], s: [0.3, 0.22, 0.24], ry: ryFor(-n[0], -n[1]) });
    }
  }
}

function qfn(p: Part, out: InstanceSets) {
  const N = p.pins ?? 8;
  const pitch = p.pitch ?? 0.5;
  const half = p.w / 2;
  for (const { n, t } of SIDES) {
    const ry = ryFor(n[0], n[1]);
    for (let i = 0; i < N; i++) {
      const s = (i - (N - 1) / 2) * pitch;
      const bx = p.x + n[0] * half + t[0] * s;
      const bz = p.y + n[1] * half + t[1] * s;
      out.metal.push({ p: [bx - n[0] * 0.02, 0.02, bz - n[1] * 0.02], s: [0.06, 0.2, pitch * 0.5], ry });
      out.fillets.push({ p: [bx, 0, bz], s: [0.24, 0.17, pitch * 0.5], ry });
    }
  }
}

function perimeterBalls(p: Part, out: InstanceSets, pitch: number, inset: number, d: number, y: number) {
  const nx = Math.floor((p.w - inset * 2) / pitch);
  const nz = Math.floor((p.h - inset * 2) / pitch);
  const x0 = p.x - (nx * pitch) / 2;
  const z0 = p.y - (nz * pitch) / 2;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const second = i === 1 || j === 1 || i === nx - 1 || j === nz - 1;
      if (!edge && !second) continue;
      out.balls.push({ p: [x0 + i * pitch, y, z0 + j * pitch], s: [d, d * 0.82, d] });
    }
  }
}

function bga(p: Part, out: InstanceSets) {
  if (p.ref === "U1") {
    // underfilled SoC: an epoxy meniscus along each edge hides the balls
    for (const { n, t } of SIDES) {
      const len = Math.abs(t[0]) ? p.w : p.h;
      const half = Math.abs(n[0]) ? p.w / 2 : p.h / 2;
      out.underfill.push({
        p: [p.x + n[0] * half, 0, p.y + n[1] * half],
        s: [0.55, 0.42, len + 0.5],
        ry: ryFor(n[0], n[1]),
      });
    }
  } else {
    perimeterBalls(p, out, 0.5, 0.45, 0.32, 0.0);
  }
}

function wlcsp(p: Part, out: InstanceSets) {
  perimeterBalls(p, out, 0.4, 0.3, 0.24, 0.0);
}

function b2b(p: Part, out: InstanceSets) {
  const N = p.pins ?? 20;
  const pitch = p.pitch ?? 0.4;
  const vertical = p.rot === 90;
  const L = vertical ? p.h : p.w;
  const S = vertical ? p.w : p.h;
  const span = (N - 1) * pitch;
  // map local (along, across) to board (x, z)
  const at = (a: number, b: number): [number, number] => (vertical ? [p.x + b, p.y + a] : [p.x + a, p.y + b]);
  for (const side of [-1, 1]) {
    const [nx, nz] = vertical ? [side, 0] : [0, side];
    const ry = ryFor(nx, nz);
    for (let i = 0; i < N; i++) {
      const a = -span / 2 + i * pitch;
      const [x, z] = at(a, side * (S / 2 - 0.1));
      // gold solder tail running out over the pad
      out.gold.push({ p: [x + nx * 0.22, 0.0, z + nz * 0.22], s: [0.5, 0.1, 0.16], ry });
      out.fillets.push({ p: [x + nx * 0.47, 0, z + nz * 0.47], s: [0.17, 0.1, 0.18], ry });
    }
  }
  // stamped hold-down brackets at both ends
  for (const e of [-1, 1]) {
    const [x, z] = at(e * (L / 2 + 0.2), 0);
    const [nx, nz] = vertical ? [0, e] : [e, 0];
    out.metal.push({ p: [x, 0.0, z], s: [0.45, p.height * 0.75, S + 0.3], ry: ryFor(nx, nz) });
    out.fillets.push({ p: [x + nx * 0.22, 0, z + nz * 0.22], s: [0.25, 0.2, S + 0.2], ry: ryFor(nx, nz) });
  }
}

function endTerminated(p: Part, out: InstanceSets, termLen: number, termH: number, termW: number) {
  const vertical = p.h > p.w || p.rot === 90;
  const L = vertical ? p.h : p.w;
  const W = vertical ? p.w : p.h;
  for (const e of [-1, 1]) {
    const [nx, nz] = vertical ? [0, e] : [e, 0];
    const ry = ryFor(nx, nz);
    const off = L / 2 - termLen / 2 + 0.03;
    out.metal.push({ p: [p.x + nx * off, 0.0, p.y + nz * off], s: [termLen, p.height * termH, W * termW], ry });
    out.fillets.push({ p: [p.x + nx * (L / 2 + 0.03), 0, p.y + nz * (L / 2 + 0.03)], s: [0.32, p.height * 0.32, W * termW * 0.92], ry });
  }
}
