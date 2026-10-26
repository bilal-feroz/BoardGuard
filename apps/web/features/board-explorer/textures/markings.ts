/**
 * Small procedural textures for component tops: laser-marked epoxy, the RF
 * shield's stamped lid and the board-to-board connector housing.
 * Each returns an sRGB albedo canvas and a packed data canvas (R height, G roughness, B metalness).
 */
import type { Part } from "../model/layout";
import { mulberry32 } from "../model/rng";
import { ctx2d, data, makeCanvas } from "./canvas";

export interface TexturePair {
  albedo: HTMLCanvasElement;
  data: HTMLCanvasElement;
}

function pair(wPx: number, hPx: number) {
  const albedo = makeCanvas(wPx, hPx);
  const dat = makeCanvas(wPx, hPx);
  return { albedo, data: dat, a: ctx2d(albedo), d: ctx2d(dat) };
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, colors: string[], count: number, size: number) {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    const s = size * (0.5 + rnd());
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

/** Laser-marked black epoxy (BGA mold cap, QFP, QFN, inductors, tantalums). */
export function paintEpoxyTop(
  wMm: number,
  hMm: number,
  lines: string[],
  monoFamily: string,
  opts: { pxPerMm?: number; pin1?: boolean; logo?: boolean; seed?: number; base?: string; ink?: string; band?: "left" | "top"; metal?: boolean } = {},
): TexturePair {
  const ppm = opts.pxPerMm ?? 48;
  const W = Math.max(64, Math.round(wMm * ppm));
  const H = Math.max(64, Math.round(hMm * ppm));
  const { albedo, data: dat, a, d } = pair(W, H);
  const sx = W / wMm;
  const sy = H / hMm;
  const base = opts.base ?? "#121314";
  const ink = opts.ink ?? "#5e6261";

  a.fillStyle = base;
  a.fillRect(0, 0, W, H);
  const metal = opts.metal ? 255 : 0;
  d.fillStyle = data(128, opts.metal ? 120 : 166, metal);
  d.fillRect(0, 0, W, H);
  if (!opts.metal) {
    speckle(a, W, H, opts.seed ?? 3, ["#18191a", "#0f1011", "#1b1c1d"], Math.round(W * H * 0.02), 1.6);
    speckle(d, W, H, (opts.seed ?? 3) + 1, [data(128, 176, 0), data(128, 154, 0)], Math.round(W * H * 0.02), 1.6);
  } else {
    // seam-welded lid: a slightly raised inner field inside the weld seam
    a.strokeStyle = "rgba(40,42,42,0.45)";
    a.lineWidth = Math.max(1, Math.min(W, H) * 0.035);
    a.strokeRect(a.lineWidth, a.lineWidth, W - a.lineWidth * 2, H - a.lineWidth * 2);
    d.strokeStyle = data(90, 170, 255);
    d.lineWidth = a.lineWidth;
    d.strokeRect(a.lineWidth, a.lineWidth, W - a.lineWidth * 2, H - a.lineWidth * 2);
  }

  if (opts.band) {
    // tantalum polarity band
    a.fillStyle = "#8d8a80";
    d.fillStyle = data(140, 190, 0);
    if (opts.band === "left") {
      a.fillRect(0, 0, W * 0.2, H);
      d.fillRect(0, 0, W * 0.2, H);
    } else {
      a.fillRect(0, 0, W, H * 0.2);
      d.fillRect(0, 0, W, H * 0.2);
    }
  }

  // laser marking
  const n = lines.length;
  if (n) {
    const minDim = Math.min(wMm, hMm);
    const lh = Math.min((hMm * 0.6) / n, minDim * (minDim < 4 ? 0.3 : 0.11));
    const fontMm = lh * 0.74;
    for (const [ctx, style] of [
      [a, ink],
      [d, data(100, 215, metal)],
    ] as const) {
      ctx.save();
      ctx.font = `500 ${fontMm * sy}px ${monoFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = style;
      lines.forEach((t, i) => {
        const y = hMm / 2 + (i - (n - 1) / 2) * lh + (opts.logo ? lh * 0.6 : 0);
        // condense long strings to fit the package
        const maxW = wMm * 0.8 * sx;
        const mw = ctx.measureText(t).width;
        ctx.save();
        ctx.translate((wMm / 2) * sx, y * sy);
        if (mw > maxW) ctx.scale(maxW / mw, 1);
        ctx.fillText(t, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    }
  }

  if (opts.logo) {
    // a neutral geometric maker's mark (not any real brand)
    const minDim = Math.min(wMm, hMm);
    const r = minDim * 0.045;
    const cx = wMm * 0.5;
    const cy = hMm * 0.5 - (n * minDim * 0.11) / 2 - r * 0.4;
    for (const [ctx, style] of [
      [a, ink],
      [d, data(100, 215, 0)],
    ] as const) {
      ctx.save();
      ctx.scale(sx, sy);
      ctx.strokeStyle = style;
      ctx.lineWidth = r * 0.28;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy + r * 0.45);
      ctx.lineTo(cx, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.45);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (opts.pin1) {
    const r = Math.min(wMm, hMm) * 0.045;
    const cx = Math.max(r * 2.2, 0.55);
    const cy = Math.max(r * 2.2, 0.55);
    a.save();
    a.scale(sx, sy);
    a.fillStyle = "#0f1011";
    a.beginPath();
    a.arc(cx, cy, r, 0, Math.PI * 2);
    a.fill();
    a.fillStyle = "rgba(255,255,255,0.05)";
    a.beginPath();
    a.arc(cx - r * 0.2, cy - r * 0.2, r * 0.6, 0, Math.PI * 2);
    a.fill();
    a.restore();
    d.save();
    d.scale(sx, sy);
    d.fillStyle = data(40, 70, 0);
    d.beginPath();
    d.arc(cx, cy, r, 0, Math.PI * 2);
    d.fill();
    d.restore();
  }
  return { albedo, data: dat };
}

/** Stamped nickel-silver RF shield lid: brushed grain, vent hole field, embossed ribs, pick-up pad. */
export function paintShieldTop(wMm: number, hMm: number, monoFamily: string): TexturePair {
  const ppm = 40;
  const W = Math.round(wMm * ppm);
  const H = Math.round(hMm * ppm);
  const { albedo, data: dat, a, d } = pair(W, H);
  const rnd = mulberry32(911);

  a.fillStyle = "#c3c5c1";
  a.fillRect(0, 0, W, H);
  d.fillStyle = data(140, 92, 255);
  d.fillRect(0, 0, W, H);

  // brushed grain along x
  for (let i = 0; i < H * 1.4; i++) {
    const y = rnd() * H;
    const v = rnd();
    a.fillStyle = v < 0.5 ? `rgba(255,255,255,${0.04 + rnd() * 0.06})` : `rgba(40,44,46,${0.04 + rnd() * 0.06})`;
    const x = rnd() * W * 0.3;
    a.fillRect(x - W * 0.2, y, W * (0.6 + rnd() * 0.8), 0.6 + rnd() * 0.9);
    d.fillStyle = v < 0.5 ? data(140, 78, 255) : data(140, 112, 255);
    d.fillRect(x - W * 0.2, y, W * (0.6 + rnd() * 0.8), 0.6 + rnd() * 0.9);
  }

  a.save();
  d.save();
  a.scale(ppm, ppm);
  d.scale(ppm, ppm);

  // embossed perimeter rib
  const rib = (ctx: CanvasRenderingContext2D, style: string, w: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.roundRect(1.2, 1.2, wMm - 2.4, hMm - 2.4, 0.8);
    ctx.stroke();
  };
  rib(a, "rgba(255,255,255,0.10)", 0.5);
  rib(d, data(190, 70, 255), 0.5);
  a.translate(0.12, 0.12);
  rib(a, "rgba(20,24,26,0.12)", 0.18);
  a.translate(-0.12, -0.12);

  // vent / reflow hole field on both sides of the pick-up pad
  const pad = { x0: wMm * 0.38, x1: wMm * 0.62, y0: hMm * 0.22, y1: hMm * 0.78 };
  for (let y = 2.4; y < hMm - 2.2; y += 1.05) {
    for (let x = 2.4; x < wMm - 2.2; x += 1.05) {
      const ox = (Math.round((y - 2.4) / 1.05) % 2) * 0.52;
      const px = x + ox;
      if (px > pad.x0 - 0.8 && px < pad.x1 + 0.8 && y > pad.y0 - 0.8 && y < pad.y1 + 0.8) continue;
      if (px > wMm - 2.2) continue;
      a.fillStyle = "#3a3d3c";
      a.beginPath();
      a.arc(px + 0.04, y + 0.05, 0.3, 0, Math.PI * 2);
      a.fill();
      a.fillStyle = "#0b0d0d";
      a.beginPath();
      a.arc(px, y, 0.26, 0, Math.PI * 2);
      a.fill();
      d.fillStyle = data(0, 230, 0);
      d.beginPath();
      d.arc(px, y, 0.28, 0, Math.PI * 2);
      d.fill();
    }
  }

  // smooth pick-and-place pad (slightly raised, finer finish)
  a.fillStyle = "rgba(255,255,255,0.07)";
  a.beginPath();
  a.roundRect(pad.x0, pad.y0, pad.x1 - pad.x0, pad.y1 - pad.y0, 0.6);
  a.fill();
  d.fillStyle = data(170, 62, 255);
  d.beginPath();
  d.roundRect(pad.x0, pad.y0, pad.x1 - pad.x0, pad.y1 - pad.y0, 0.6);
  d.fill();

  // laser-etched ID on the pad
  for (const [ctx, style] of [
    [a, "rgba(60,64,66,0.85)"],
    [d, data(150, 140, 200)],
  ] as const) {
    ctx.font = `500 0.95px ${monoFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = style;
    ctx.fillText("RF-FE", wMm / 2, hMm / 2 - 0.75);
    ctx.font = `500 0.7px ${monoFamily}`;
    ctx.fillText("SH1 2614", wMm / 2, hMm / 2 + 0.5);
  }

  a.restore();
  d.restore();
  return { albedo, data: dat };
}

/** Board-to-board receptacle housing: dark LCP with a recessed mating slot and two rows of gold contacts. */
export function paintB2BTop(part: Part): TexturePair {
  const vertical = part.rot === 90;
  const L = vertical ? part.h : part.w; // long axis
  const S = vertical ? part.w : part.h; // short axis
  const ppm = 64;
  // Paint in the part's local frame (long axis = canvas x); the 3D side rotates UVs.
  const W = Math.round(L * ppm);
  const H = Math.round(S * ppm);
  const { albedo, data: dat, a, d } = pair(W, H);
  a.scale(ppm, ppm);
  d.scale(ppm, ppm);

  a.fillStyle = "#1e1f1f";
  a.fillRect(0, 0, L, S);
  d.fillStyle = data(140, 120, 0);
  d.fillRect(0, 0, L, S);

  // mating slot
  const slot = { x: 0.9, y: S * 0.3, w: L - 1.8, h: S * 0.4 };
  a.fillStyle = "#0b0c0c";
  a.fillRect(slot.x, slot.y, slot.w, slot.h);
  d.fillStyle = data(30, 200, 0);
  d.fillRect(slot.x, slot.y, slot.w, slot.h);
  // central island
  a.fillStyle = "#232424";
  a.fillRect(slot.x + 0.3, S * 0.44, slot.w - 0.6, S * 0.12);
  d.fillStyle = data(120, 130, 0);
  d.fillRect(slot.x + 0.3, S * 0.44, slot.w - 0.6, S * 0.12);

  // contacts
  const n = part.pins ?? 20;
  const pitch = part.pitch ?? 0.4;
  const span = (n - 1) * pitch;
  for (let i = 0; i < n; i++) {
    const x = L / 2 - span / 2 + i * pitch;
    for (const y of [S * 0.3, S * 0.56]) {
      a.fillStyle = "#c9a660";
      a.fillRect(x - 0.07, y, 0.14, S * 0.14);
      d.fillStyle = data(150, 70, 255);
      d.fillRect(x - 0.07, y, 0.14, S * 0.14);
    }
  }
  // moulded rim highlight
  a.strokeStyle = "rgba(255,255,255,0.05)";
  a.lineWidth = 0.08;
  a.strokeRect(0.1, 0.1, L - 0.2, S - 0.2);
  return { albedo, data: dat };
}
