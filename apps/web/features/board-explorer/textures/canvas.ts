/** Small canvas helpers shared by the procedural texture painters. */

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

/** Resolve a next/font CSS variable (e.g. --font-plex-mono) to a usable canvas font-family list. */
export function resolveFontFamily(cssVar: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export async function ensureFonts(families: string[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.race([
      Promise.all(families.map((f) => document.fonts.load(`600 24px ${f}`))).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    // Fonts are a nicety; fall back silently.
  }
}

/** rgb() string for the packed data texture: R = height, G = roughness, B = metalness (0..255). */
export function data(h: number, r: number, m: number): string {
  return `rgb(${h | 0},${r | 0},${m | 0})`;
}
