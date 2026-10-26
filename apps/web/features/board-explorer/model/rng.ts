/** Small deterministic PRNG so the procedural board is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D occupancy grid in board millimetres, used to keep the procedural layout collision-free. */
export class OccGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private data: Uint8Array;

  constructor(widthMm: number, heightMm: number, cell = 0.2) {
    this.cell = cell;
    this.cols = Math.ceil(widthMm / cell);
    this.rows = Math.ceil(heightMm / cell);
    this.data = new Uint8Array(this.cols * this.rows);
  }

  /** Cell range covered by a rect; `inset` (in cells) lets queries tolerate edge-touching neighbours. */
  private range(x0: number, y0: number, x1: number, y1: number, inset = 0) {
    const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / this.cell + inset));
    const c1 = Math.min(this.cols - 1, Math.floor(Math.max(x0, x1) / this.cell - inset));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / this.cell + inset));
    const r1 = Math.min(this.rows - 1, Math.floor(Math.max(y0, y1) / this.cell - inset));
    return { c0, c1, r0, r1 };
  }

  markRect(x0: number, y0: number, x1: number, y1: number) {
    const { c0, c1, r0, r1 } = this.range(x0, y0, x1, y1);
    for (let r = r0; r <= r1; r++) this.data.fill(1, r * this.cols + c0, r * this.cols + c1 + 1);
  }

  freeRect(x0: number, y0: number, x1: number, y1: number): boolean {
    const { c0, c1, r0, r1 } = this.range(x0, y0, x1, y1, 0.3);
    for (let r = r0; r <= r1; r++) {
      const base = r * this.cols;
      for (let c = c0; c <= c1; c++) if (this.data[base + c]) return false;
    }
    return true;
  }

  markCircle(x: number, y: number, rad: number) {
    const { c0, c1, r0, r1 } = this.range(x - rad, y - rad, x + rad, y + rad);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * this.cell;
        const cy = (r + 0.5) * this.cell;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + this.cell * 0.5) ** 2) this.data[r * this.cols + c] = 1;
      }
    }
  }

  markSegment(ax: number, ay: number, bx: number, by: number, rad: number) {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.markCircle(ax + (bx - ax) * t, ay + (by - ay) * t, rad);
    }
  }

  freeCircle(x: number, y: number, rad: number): boolean {
    return this.freeRect(x - rad, y - rad, x + rad, y + rad);
  }
}
