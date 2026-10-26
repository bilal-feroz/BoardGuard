"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { apiUrl, type Candidate, type Observation, type Session } from "@/lib/api";
import { calibrationKey, useStore, type Calibration } from "@/lib/store";
import { candidateColor, TYPE_SHORT } from "@/lib/status";
import ImageCanvas from "./ImageCanvas";

function Brackets({ x, y, w, h, color, dashed }: { x: number; y: number; w: number; h: number; color: string; dashed?: boolean }) {
  const k = Math.max(6, Math.min(w, h) * 0.28);
  const d = `M${x},${y + k}V${y}H${x + k} M${x + w - k},${y}H${x + w}V${y + k} M${x + w},${y + h - k}V${y + h}H${x + w - k} M${x + k},${y + h}H${x}V${y + h - k}`;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeOpacity={dashed ? 0.9 : 0.35} strokeWidth={1}
        strokeDasharray={dashed ? "5 4" : undefined} vectorEffect="non-scaling-stroke" />
      {!dashed && <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </g>
  );
}

export function candidateStatus(session: Session, c: Candidate) {
  const f = session.findings.find((x) => x.id === c.id);
  return f;
}

/** Common fine-pitch package lead pitches (mm). */
const PITCHES = [0.4, 0.5, 0.635, 0.65, 0.8, 1.0, 1.27, 2.54];

function ScalePanel({ obs, calibration, rulerPx }: { obs: Observation; calibration: Calibration | undefined; rulerPx: number | null }) {
  const setCalibration = useStore((s) => s.setCalibration);
  const rows = useMemo(() => [...(obs.detection?.lead_rows ?? [])].sort((a, b) => b.lead_count - a.lead_count), [obs]);
  const [rowIdx, setRowIdx] = useState(0);
  const [pitch, setPitch] = useState(0.5);
  const [knownMm, setKnownMm] = useState("");
  const row = rows[Math.min(rowIdx, rows.length - 1)];
  const known = parseFloat(knownMm);

  return (
    <div className="pointer-events-auto absolute bottom-10 left-3 z-10 w-[300px] rounded-[4px] border border-line-strong bg-panel/95 p-3 text-[11.5px] shadow-xl shadow-black/40"
      onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="label !text-ink-2">Scale · {obs.obs_id}</span>
        {calibration && (
          <button type="button" className="mono text-[10.5px] text-muted hover:text-ink" onClick={() => setCalibration(obs.obs_id, null)}>clear</button>
        )}
      </div>
      <p className={`mono mt-1 ${calibration ? "text-teal" : "text-muted"}`}>
        {calibration ? `1 px = ${calibration.mmPerPx.toPrecision(3)} mm · ${calibration.source}` : "Uncalibrated: ruler shows pixels."}
      </p>
      {rows.length > 0 ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <div className="text-ink-2">From a detected lead row (known package pitch)</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <select aria-label="Lead row" value={Math.min(rowIdx, rows.length - 1)} onChange={(e) => setRowIdx(+e.target.value)}
              className="mono h-7 min-w-0 flex-1 rounded-[3px] border border-line bg-bg px-1 text-[11px] text-ink-2">
              {rows.map((r, i) => <option key={r.row} value={i}>row {r.row} · {r.lead_count} leads · {r.pitch_px.toFixed(1)} px</option>)}
            </select>
            <select aria-label="Package lead pitch" value={pitch} onChange={(e) => setPitch(+e.target.value)}
              className="mono h-7 rounded-[3px] border border-line bg-bg px-1 text-[11px] text-ink-2">
              {PITCHES.map((p) => <option key={p} value={p}>{p} mm</option>)}
            </select>
            <button type="button" disabled={!row} onClick={() => row && setCalibration(obs.obs_id, { mmPerPx: pitch / row.pitch_px, source: `lead pitch ${pitch} mm (row ${row.row})` })}
              className="h-7 rounded-[3px] border border-line-strong px-2 text-ink hover:bg-raised">Set</button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-faint">No regular IC lead row detected in this capture; calibrate with the ruler instead.</p>
      )}
      <div className="mt-2.5 border-t border-line pt-2.5">
        <div className="text-ink-2">From the ruler over a known distance</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="mono text-muted">{rulerPx ? `${rulerPx.toFixed(1)} px =` : "draw a ruler first"}</span>
          <input aria-label="Known length in millimetres" inputMode="decimal" value={knownMm} onChange={(e) => setKnownMm(e.target.value)} placeholder="mm"
            className="mono h-7 w-16 rounded-[3px] border border-line bg-bg px-1.5 text-[11px] text-ink placeholder:text-faint" />
          <button type="button" disabled={!rulerPx || !(known > 0)}
            onClick={() => rulerPx && known > 0 && setCalibration(obs.obs_id, { mmPerPx: known / rulerPx, source: `ruler ${known} mm` })}
            className="h-7 rounded-[3px] border border-line-strong px-2 text-ink hover:bg-raised disabled:opacity-40">Set</button>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-faint">Valid in the plane of the reference only (no perspective correction). Stored in this browser.</p>
    </div>
  );
}

export default function MicroscopeView({ obs }: { obs: Observation }) {
  const session = useStore((s) => s.session)!;
  const layers = useStore((s) => s.layers);
  const tool = useStore((s) => s.tool);
  const selectedCandidateId = useStore((s) => s.selectedCandidateId);
  const selectCandidate = useStore((s) => s.selectCandidate);
  const showOriginal = useStore((s) => s.showOriginal);
  const regionCheck = useStore((s) => s.regionCheck);
  const regionBusy = useStore((s) => s.regionCheckBusy);
  const checkRegion = useStore((s) => s.checkRegion);
  const calibration = useStore((s) => s.calibrations[calibrationKey(s.session, obs.obs_id)]);
  const [ruler, setRuler] = useState<{ obsId: string; px: number | null }>({ obsId: obs.obs_id, px: null });
  const rulerPx = ruler.obsId === obs.obs_id ? ruler.px : null;

  const pending = session.pending_action;
  const isTargetObs = pending?.type === "RECAPTURE" && pending.reference_obs_id === obs.obs_id;
  const cands = obs.candidates;
  const check = regionCheck?.obs_id === obs.obs_id ? regionCheck : null;

  const rasterLayers = useMemo(() => {
    if (showOriginal) return [];
    const out: { src: string; key: string; opacity?: number }[] = [];
    if (layers.glare && obs.quality?.glare_overlay_url) out.push({ src: apiUrl(obs.quality.glare_overlay_url)!, key: "glare", opacity: 0.9 });
    if (layers.corrosionMask && obs.detection?.layer_urls?.corrosion_mask) out.push({ src: apiUrl(obs.detection.layer_urls.corrosion_mask)!, key: "corr", opacity: 0.85 });
    if (layers.metalMask && obs.detection?.layer_urls?.metal_mask) out.push({ src: apiUrl(obs.detection.layer_urls.metal_mask)!, key: "metal", opacity: 0.85 });
    return out;
  }, [layers, obs, showOriginal]);

  const svg = showOriginal ? null : (
    <g>
      {layers.tiles && obs.quality?.tiles.unusable.map((t, i) => (
        <g key={i}>
          <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="#D8AA68" fillOpacity={0.08} stroke="#D8AA68" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={`M${t.x},${t.y + t.h}L${t.x + t.w},${t.y}`} stroke="#D8AA68" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {layers.targets && isTargetObs && pending?.target_bboxes?.map((b, i) => (
        <rect key={`t${i}`} x={b[0] - 10} y={b[1] - 10} width={b[2] + 20} height={b[3] + 20} fill="none" stroke="#D8AA68" strokeWidth={1.5} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      ))}
      {layers.candidates && cands.map((c) => {
        const f = candidateStatus(session, c);
        const insufficient = c.evidence_quality ? !c.evidence_quality.sufficient : false;
        const color = candidateColor(f?.status, insufficient);
        const [x, y, w, h] = c.bbox;
        const sel = c.id === selectedCandidateId;
        return (
          <g key={c.id} onClick={(e) => { e.stopPropagation(); selectCandidate(c.id); }} className="cursor-pointer" style={{ pointerEvents: tool === "navigate" ? "all" : "none" }}>
            {c.polygon && c.type === "suspected_corrosion" && (
              <polygon points={c.polygon.map((p) => p.join(",")).join(" ")} fill={color} fillOpacity={sel ? 0.16 : 0.07} stroke={color} strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
            <Brackets x={x} y={y} w={w} h={h} color={color} dashed={c.mapped_only} />
            {sel && <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} fill="none" stroke="#F0F0EB" strokeOpacity={0.9} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            <rect x={x} y={y} width={w} height={h} fill="transparent" />
          </g>
        );
      })}
      {regionBusy && (
        <rect x={regionBusy[0]} y={regionBusy[1]} width={regionBusy[2]} height={regionBusy[3]} fill="rgba(233,217,180,0.06)" stroke="#E9D9B4"
          strokeWidth={1.25} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" className="animate-pulse" />
      )}
      {check && !regionBusy && (
        <rect x={check.rect[0]} y={check.rect[1]} width={check.rect[2]} height={check.rect[3]} fill="none"
          stroke={check.sufficient ? "#79ADA0" : "#D8AA68"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );

  return (
    <ImageCanvas
      src={apiUrl(obs.capture_url)!}
      width={obs.width}
      height={obs.height}
      layers={rasterLayers}
      svg={svg}
      tool={tool}
      mmPerPx={calibration?.mmPerPx}
      onRuler={(px) => setRuler({ obsId: obs.obs_id, px })}
      onRegion={(rect) => checkRegion(obs.obs_id, rect)}
      pxToOriginal={1 / obs.scale_to_working}
      ariaLabel={`Microscope capture ${obs.obs_id}, ${obs.width} by ${obs.height} pixels, ${cands.length} candidate overlays`}
      onImageClick={() => selectCandidate(null)}
      fitKey={obs.obs_id}
      screen={({ toScreen }) => (
        <>
          {!showOriginal && layers.candidates && cands.map((c) => {
            const f = candidateStatus(session, c);
            const insufficient = c.evidence_quality ? !c.evidence_quality.sufficient : false;
            const color = candidateColor(f?.status, insufficient);
            const [sx, sy] = toScreen(c.bbox[0], c.bbox[1]);
            const sel = c.id === selectedCandidateId;
            return (
              <button
                key={c.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => selectCandidate(c.id)}
                className={`pointer-events-auto absolute mono flex -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-t-[3px] border border-b-0 px-1.5 py-[1px] text-[10.5px] ${sel ? "bg-ink text-bg" : "bg-bg/85 text-ink"}`}
                style={{ left: sx, top: sy - 1, borderColor: color }}
                aria-label={`Select ${c.id}`}
              >
                <span style={{ color: sel ? undefined : color }}>{c.id}</span>
                <span className={sel ? "" : "text-muted"}>{TYPE_SHORT[c.type]}</span>
                {c.mapped_only ? <span className={sel ? "" : "text-muted"}>mapped · {c.reinspection_outcome?.toLowerCase().replace("_", " ")}</span>
                  : insufficient ? <span style={{ color: sel ? undefined : "#D8AA68" }}>insufficient evidence</span> : null}
              </button>
            );
          })}
          {check && !regionBusy && !showOriginal && (() => {
            const [sx, sy] = toScreen(check.rect[0], check.rect[1] + check.rect[3]);
            return (
              <span className={`mono absolute whitespace-nowrap rounded-b-[3px] border border-t-0 bg-bg/85 px-1.5 py-[1px] text-[10.5px] ${check.sufficient ? "border-teal text-teal" : "border-amber text-amber"}`}
                style={{ left: sx, top: sy }}>
                region · {check.sufficient ? "evidence sufficient" : check.issues.map((i) => i.code.toLowerCase()).join(", ")}
              </span>
            );
          })()}
        </>
      )}
    >
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <span className="mono rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px] text-ink">
          {obs.obs_id} <span className="text-muted">· {obs.role}</span>
        </span>
        <span className="mono max-w-[520px] truncate rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[10.5px] text-muted" title={obs.source.provenance}>
          {obs.source.synthetic ? "SYNTHETIC · " : obs.source.kind === "fixture" ? "RECORDED IMAGE · " : obs.source.kind === "camera" ? "LIVE CAPTURE · " : "UPLOAD · "}
          {obs.source.label}
        </span>
        {showOriginal && <span className="mono rounded-[3px] border border-amber/50 bg-bg/85 px-2 py-0.5 text-[10.5px] text-amber">Original image · overlays hidden</span>}
        {calibration && tool !== "measure" && (
          <span className="mono flex items-center gap-1 rounded-[3px] border border-teal/40 bg-bg/85 px-2 py-0.5 text-[10.5px] text-teal" title={calibration.source}>
            <Icon.Measure size={11} /> 1 px = {calibration.mmPerPx.toPrecision(3)} mm
          </span>
        )}
      </div>
      {tool === "measure" && <ScalePanel obs={obs} calibration={calibration} rulerPx={rulerPx} />}
    </ImageCanvas>
  );
}
