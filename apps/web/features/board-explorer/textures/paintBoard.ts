/**
 * Paints the PCB surface into two canvases from the shared layout model:
 *  - albedo (sRGB): solder mask, copper under mask, ENIG / solder pads, silkscreen
 *  - data (linear, packed): R = height (bump), G = roughness, B = metalness
 *
 * Both are drawn in board millimetres via a scale transform so any resolution
 * can be produced from the same vector description.
 */
import { BOARD_OUTLINE, MOUNTING_HOLES, type Pt } from "../model/outline";
import type { BoardLayout, Pad, SilkText } from "../model/layout";
import { BOARD_H, BOARD_W } from "../model/units";
import { mulberry32 } from "../model/rng";
import { ctx2d, data, makeCanvas } from "./canvas";

// Albedo palette (sRGB)
const C = {
  laminate: "#0e3628", // mask over bare laminate (no copper)
  pour: "#164e3c", // mask over ground pour
  island: "#185440",
  trace: "#1f6249", // mask over a trace: slightly raised and lighter
  viaRing: "#226850",
  viaHole: "#06150f",
  padEdge: "#0a1f17",
  enig: "#e2c27e",
  solder: "#cfd0cb",
  silk: "#e2dfd3",
  bareFr4: "#8c8457",
  bareFr4Dark: "#4c4a2c",
  exposedCu: "#dcb978",
};

// Packed data values
const D = {
  laminate: data(70, 150, 0),
  pour: data(100, 136, 0),
  trace: data(128, 126, 0),
  viaRing: data(126, 126, 0),
  viaHole: data(55, 150, 0),
  padEdge: data(90, 160, 0),
  enig: data(150, 66, 255),
  solder: data(162, 54, 255),
  silk: data(158, 196, 0),
  bareFr4: data(40, 205, 0),
  exposedCu: data(118, 78, 255),
};

export interface BoardCanvases {
  albedo: HTMLCanvasElement;
  data: HTMLCanvasElement;
  pxPerMm: number;
}

type Ctx = CanvasRenderingContext2D;

function outlinePath(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function polyPath(ctx: Ctx, pts: Pt[], closed = false) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
}

function padPath(ctx: Ctx, p: Pad, grow = 0) {
  ctx.beginPath();
  if (p.round) {
    ctx.arc(p.x, p.y, p.w / 2 + grow, 0, Math.PI * 2);
  } else {
    const r = Math.min(p.w, p.h) * 0.12 + grow;
    ctx.roundRect(p.x - p.w / 2 - grow, p.y - p.h / 2 - grow, p.w + grow * 2, p.h + grow * 2, Math.max(0, r));
  }
}

/** Run the same drawing on both canvases with different fills. */
class Dual {
  constructor(
    private a: Ctx,
    private d: Ctx,
  ) {}

  fill(path: (ctx: Ctx) => void, albedo: string, dat: string) {
    path(this.a);
    this.a.fillStyle = albedo;
    this.a.fill();
    path(this.d);
    this.d.fillStyle = dat;
    this.d.fill();
  }

  stroke(path: (ctx: Ctx) => void, width: number, albedo: string, dat: string, cap: CanvasLineCap = "round") {
    for (const [ctx, style] of [
      [this.a, albedo],
      [this.d, dat],
    ] as const) {
      path(ctx);
      ctx.lineWidth = width;
      ctx.lineCap = cap;
      ctx.lineJoin = "round";
      ctx.strokeStyle = style;
      ctx.stroke();
    }
  }
}

export function paintBoard(layout: BoardLayout, width: number, fontFamily: string): BoardCanvases {
  const height = Math.round((width * BOARD_H) / BOARD_W);
  const s = width / BOARD_W;
  const albedo = makeCanvas(width, height);
  const dataC = makeCanvas(width, height);
  const a = ctx2d(albedo);
  const d = ctx2d(dataC);
  const rnd = mulberry32(77);

  for (const ctx of [a, d]) ctx.setTransform(s, 0, 0, s, 0, 0);
  const dual = new Dual(a, d);

  // 1. laminate under mask, everywhere
  a.fillStyle = C.laminate;
  a.fillRect(-1, -1, BOARD_W + 2, BOARD_H + 2);
  d.fillStyle = D.laminate;
  d.fillRect(-1, -1, BOARD_W + 2, BOARD_H + 2);

  // 2. ground pour, pulled back from the routed edge
  dual.fill((c) => outlinePath(c, BOARD_OUTLINE), C.pour, D.pour);
  dual.stroke((c) => outlinePath(c, BOARD_OUTLINE), 1.3, C.laminate, D.laminate);
  // pour voids under antenna feeds
  dual.fill((c) => {
    c.beginPath();
    c.roundRect(46.4, 72.6, 6.4, 6.6, 0.6);
    c.roundRect(1.6, 55.8, 5.6, 6.4, 0.6);
  }, C.laminate, D.laminate);

  // 2b. subtle low-frequency mottling of the mask (albedo only)
  a.save();
  for (let i = 0; i < 260; i++) {
    const x = rnd() * BOARD_W;
    const y = rnd() * BOARD_H;
    const r = 3 + rnd() * 14;
    const g = a.createRadialGradient(x, y, 0, x, y, r);
    const light = rnd() < 0.5;
    g.addColorStop(0, light ? "rgba(70,120,95,0.05)" : "rgba(0,20,12,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    a.fillStyle = g;
    a.fillRect(x - r, y - r, r * 2, r * 2);
  }
  a.restore();

  // 3. split-plane islands
  for (const isl of layout.islands) {
    dual.stroke((c) => polyPath(c, isl, true), 0.5, C.laminate, D.laminate);
    dual.fill((c) => polyPath(c, isl, true), C.island, D.pour);
  }

  // 4. pour clearances around pads, traces, vias
  for (const p of layout.pads) dual.fill((c) => padPath(c, p, 0.16), C.laminate, D.laminate);
  for (const t of layout.traces) {
    if (t.kind === "exposed") continue;
    const clr = t.kind === "power" ? 0.24 : t.kind === "rf" ? 0.34 : 0.075;
    dual.stroke((c) => polyPath(c, t.pts), t.w + clr * 2, C.laminate, D.laminate);
  }

  // 5. traces (mask over copper)
  for (const t of layout.traces) {
    if (t.kind === "exposed") continue;
    dual.stroke((c) => polyPath(c, t.pts), t.w, C.trace, D.trace);
  }

  // 6. tented vias
  for (const v of layout.vias) {
    dual.fill((c) => {
      c.beginPath();
      c.arc(v.x, v.y, v.d / 2, 0, Math.PI * 2);
    }, C.viaRing, D.viaRing);
  }
  for (const v of layout.vias) {
    dual.fill((c) => {
      c.beginPath();
      c.arc(v.x, v.y, v.d * 0.22, 0, Math.PI * 2);
    }, C.viaHole, D.viaHole);
  }

  // 7. silkscreen (drawn before mask openings so pads always clip it)
  for (const p of layout.silkPaths) {
    if (p.fill) dual.fill((c) => polyPath(c, p.pts, true), C.silk, D.silk);
    else dual.stroke((c) => polyPath(c, p.pts, p.closed), p.w, C.silk, D.silk, "square");
  }
  const drawText = (t: SilkText) => {
    for (const [ctx, style] of [
      [a, C.silk],
      [d, D.silk],
    ] as const) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, t.x * s, t.y * s);
      if (t.rot) ctx.rotate(t.rot);
      ctx.font = `${t.weight ?? 600} ${t.size * s}px ${fontFamily}`;
      ctx.textAlign = t.align ?? "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = style;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  };
  layout.silkText.forEach(drawText);

  // 8. solder-mask openings: pads
  for (const p of layout.pads) dual.fill((c) => padPath(c, p, 0.035), C.padEdge, D.padEdge);
  for (const p of layout.pads) {
    const isEnig = p.finish === "enig";
    dual.fill((c) => padPath(c, p), isEnig ? C.enig : C.solder, isEnig ? D.enig : D.solder);
  }
  // pad sheen: a soft brighter core on ENIG pads (albedo only) reads as plating thickness
  for (const p of layout.pads) {
    if (p.finish !== "enig") continue;
    a.save();
    padPath(a, p, -Math.min(p.w, p.h) * 0.18);
    a.fillStyle = "rgba(255,240,200,0.12)";
    a.fill();
    a.restore();
  }

  // 9. exposed laminate window with bare traces (region C)
  for (const w of layout.windows) {
    dual.fill((c) => {
      c.beginPath();
      c.roundRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0, 0.25);
    }, C.bareFr4, D.bareFr4);
    // weave texture of the glass cloth
    a.save();
    a.beginPath();
    a.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    a.clip();
    a.globalAlpha = 0.18;
    a.strokeStyle = C.bareFr4Dark;
    a.lineWidth = 0.05;
    for (let x = w.x0; x < w.x1; x += 0.22) {
      a.beginPath();
      a.moveTo(x, w.y0);
      a.lineTo(x, w.y1);
      a.stroke();
    }
    for (let y = w.y0; y < w.y1; y += 0.22) {
      a.beginPath();
      a.moveTo(w.x0, y);
      a.lineTo(w.x1, y);
      a.stroke();
    }
    a.restore();
  }
  for (const t of layout.traces) {
    if (t.kind !== "exposed") continue;
    for (const w of layout.windows) {
      for (const ctx of [a, d]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
        ctx.clip();
      }
      dual.stroke((c) => polyPath(c, t.pts), t.w, C.exposedCu, D.exposedCu, "butt");
      a.restore();
      d.restore();
    }
  }

  // 10. mounting holes: ENIG ring with a bare-laminate keep-out
  for (const h of MOUNTING_HOLES) {
    dual.fill((c) => {
      c.beginPath();
      c.arc(h.x, h.y, h.ring + 0.45, 0, Math.PI * 2);
    }, C.bareFr4Dark, D.bareFr4);
    dual.fill((c) => {
      c.beginPath();
      c.arc(h.x, h.y, h.ring, 0, Math.PI * 2);
    }, C.enig, D.enig);
    dual.fill((c) => {
      c.beginPath();
      c.arc(h.x, h.y, h.r + 0.05, 0, Math.PI * 2);
    }, "#2a2416", D.bareFr4);
  }

  // 11. fiducials
  for (const [x, y] of layout.fiducials) {
    dual.fill((c) => {
      c.beginPath();
      c.arc(x, y, 1.1, 0, Math.PI * 2);
    }, C.bareFr4Dark, D.bareFr4);
    dual.fill((c) => {
      c.beginPath();
      c.arc(x, y, 0.5, 0, Math.PI * 2);
    }, C.enig, D.enig);
  }

  // 12. roughness variation: add to G only using additive blending
  d.save();
  d.globalCompositeOperation = "lighter";
  for (let i = 0; i < 180; i++) {
    const x = rnd() * BOARD_W;
    const y = rnd() * BOARD_H;
    const r = 4 + rnd() * 18;
    const g = d.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,26,0,0.6)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    d.fillStyle = g;
    d.fillRect(x - r, y - r, r * 2, r * 2);
  }
  d.restore();

  return { albedo, data: dataC, pxPerMm: s };
}
