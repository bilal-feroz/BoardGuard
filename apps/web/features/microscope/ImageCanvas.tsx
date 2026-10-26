"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface View {
  s: number;
  tx: number;
  ty: number;
}

export interface CanvasOverlayRenderProps {
  view: View;
  toScreen: (x: number, y: number) => [number, number];
}

interface Props {
  src: string;
  width: number;
  height: number;
  /** Image-space SVG content (viewBox = image pixels). Use vectorEffect="non-scaling-stroke". */
  svg?: ReactNode;
  /** Raster overlays in image space (e.g. masks), drawn above the image. */
  layers?: { src: string; opacity?: number; key: string; blend?: React.CSSProperties["mixBlendMode"]; style?: React.CSSProperties }[];
  /** Screen-space overlay (labels) rendered with the current transform. */
  screen?: (p: CanvasOverlayRenderProps) => ReactNode;
  view?: View | null;
  onViewChange?: (v: View) => void;
  measure?: boolean;
  /** Working-px to original-px factor (1 / scale_to_working). */
  pxToOriginal?: number;
  ariaLabel: string;
  onImageClick?: (x: number, y: number) => void;
  hud?: boolean;
  fitKey?: string;
  children?: ReactNode;
}

const MIN_S = 0.05;
const MAX_S = 24;

export function fitView(cw: number, ch: number, w: number, h: number, pad = 28): View {
  const s = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h);
  return { s, tx: (cw - w * s) / 2, ty: (ch - h * s) / 2 };
}

export default function ImageCanvas({
  src, width, height, svg, layers = [], screen, view: controlled, onViewChange, measure = false, pxToOriginal = 1,
  ariaLabel, onImageClick, hud = true, fitKey, children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [local, setLocal] = useState<View | null>(null);
  const view = controlled ?? local;
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [ruler, setRuler] = useState<{ a: [number, number]; b: [number, number]; active: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const setView = useCallback((v: View) => {
    if (onViewChange) onViewChange(v);
    if (!controlled) setLocal(v);
  }, [controlled, onViewChange]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit when the image (or fitKey) changes and the container has a size.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${fitKey ?? src}|${width}x${height}`;
    if (size.w > 0 && size.h > 0 && fittedFor.current !== key) {
      fittedFor.current = key;
      if (!controlled || fitKey) setView(fitView(size.w, size.h, width, height));
    }
  }, [size, src, width, height, fitKey, controlled, setView]);

  useEffect(() => setLoaded(false), [src]);
  useEffect(() => setRuler(null), [src, measure]);

  const toImage = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const el = ref.current;
    if (!el || !view) return null;
    const r = el.getBoundingClientRect();
    return [(clientX - r.left - view.tx) / view.s, (clientY - r.top - view.ty) / view.s];
  }, [view]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    if (!view) return;
    const s = Math.min(MAX_S, Math.max(MIN_S, view.s * factor));
    const px = cx ?? size.w / 2;
    const py = cy ?? size.h / 2;
    const k = s / view.s;
    setView({ s, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k });
  }, [view, size, setView]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!view || e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (measure) {
      const p = toImage(e.clientX, e.clientY);
      if (p) setRuler({ a: p, b: p, active: true });
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImage(e.clientX, e.clientY);
    setCursor(p);
    if (measure && ruler?.active && p) {
      setRuler({ ...ruler, b: p });
      return;
    }
    const d = drag.current;
    if (d && view) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ s: view.s, tx: d.tx + dx, ty: d.ty + dy });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (measure && ruler?.active) {
      setRuler({ ...ruler, active: false });
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && onImageClick) {
      const p = toImage(e.clientX, e.clientY);
      if (p) onImageClick(p[0], p[1]);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!view) return;
    const step = 40;
    if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-") zoomAt(0.8);
    else if (e.key === "0") setView(fitView(size.w, size.h, width, height));
    else if (e.key === "ArrowLeft") setView({ ...view, tx: view.tx + step });
    else if (e.key === "ArrowRight") setView({ ...view, tx: view.tx - step });
    else if (e.key === "ArrowUp") setView({ ...view, ty: view.ty + step });
    else if (e.key === "ArrowDown") setView({ ...view, ty: view.ty - step });
    else return;
    e.preventDefault();
  };

  const toScreen = useCallback((x: number, y: number): [number, number] => (view ? [x * view.s + view.tx, y * view.s + view.ty] : [0, 0]), [view]);
  const rulerLen = ruler ? Math.hypot(ruler.b[0] - ruler.a[0], ruler.b[1] - ruler.a[1]) : 0;

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      className={`relative h-full w-full select-none overflow-hidden canvas-grid outline-none ${measure ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
    >
      {view && (
        <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, width, height }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            width={width}
            height={height}
            className="absolute inset-0 block max-w-none transition-opacity duration-300"
            style={{ width, height, imageRendering: view.s > 3 ? "pixelated" : "auto", opacity: loaded ? 1 : 0 }}
          />
          {layers.map((l) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.key} src={l.src} alt="" draggable={false} className="pointer-events-none absolute inset-0 max-w-none enter"
              style={{ width, height, opacity: l.opacity ?? 1, mixBlendMode: l.blend, imageRendering: view.s > 3 ? "pixelated" : "auto", ...l.style }} />
          ))}
          {svg && (
            <svg className="absolute inset-0 overflow-visible" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              {svg}
            </svg>
          )}
        </div>
      )}
      {view && screen && <div className="pointer-events-none absolute inset-0">{screen({ view, toScreen })}</div>}
      {ruler && view && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {(() => {
            const [ax, ay] = toScreen(...ruler.a);
            const [bx, by] = toScreen(...ruler.b);
            return (
              <g>
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#F0F0EB" strokeWidth={1.25} />
                <circle cx={ax} cy={ay} r={3} fill="#F0F0EB" />
                <circle cx={bx} cy={by} r={3} fill="#F0F0EB" />
                <g transform={`translate(${(ax + bx) / 2 + 8}, ${(ay + by) / 2 - 8})`}>
                  <rect x={-4} y={-13} width={172} height={18} rx={2} fill="#111719" stroke="#3a4648" />
                  <text x={2} y={0} fill="#F0F0EB" fontSize={11} className="mono">
                    {rulerLen.toFixed(1)} px · {(rulerLen * pxToOriginal).toFixed(0)} px orig.
                  </text>
                </g>
              </g>
            );
          })()}
        </svg>
      )}
      {children}
      {hud && view && (
        <div className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-3 mono text-[10.5px] text-muted">
          <span className="rounded-[3px] border border-line bg-bg/80 px-1.5 py-0.5 backdrop-blur-[2px]">
            {(view.s * 100).toFixed(0)}% digital zoom
          </span>
          {cursor && cursor[0] >= 0 && cursor[1] >= 0 && cursor[0] <= width && cursor[1] <= height && (
            <span className="rounded-[3px] border border-line bg-bg/80 px-1.5 py-0.5">
              x {cursor[0].toFixed(0).padStart(4, " ")} · y {cursor[1].toFixed(0).padStart(4, " ")}
            </span>
          )}
          {measure && <span className="rounded-[3px] border border-line bg-bg/80 px-1.5 py-0.5">Drag to measure · pixels, no physical calibration</span>}
        </div>
      )}
      {hud && view && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1">
          {[
            ["−", () => zoomAt(0.8), "Zoom out"],
            ["+", () => zoomAt(1.25), "Zoom in"],
            ["Fit", () => setView(fitView(size.w, size.h, width, height)), "Fit image"],
            ["1:1", () => setView({ s: 1, tx: size.w / 2 - width / 2, ty: size.h / 2 - height / 2 }), "Actual pixels"],
          ].map(([t, fn, l]) => (
            <button key={t as string} type="button" aria-label={l as string} title={l as string} onPointerDown={(e) => e.stopPropagation()} onClick={fn as () => void}
              className="mono h-6 min-w-6 rounded-[3px] border border-line bg-bg/85 px-1.5 text-[11px] text-ink-2 hover:border-line-strong hover:text-ink">
              {t as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
