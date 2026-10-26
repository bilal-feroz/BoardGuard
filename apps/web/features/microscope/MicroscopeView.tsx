"use client";

import { useMemo } from "react";
import { apiUrl, type Candidate, type Observation, type Session } from "@/lib/api";
import { useStore } from "@/lib/store";
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

export default function MicroscopeView({ obs }: { obs: Observation }) {
  const session = useStore((s) => s.session)!;
  const layers = useStore((s) => s.layers);
  const tool = useStore((s) => s.tool);
  const selectedCandidateId = useStore((s) => s.selectedCandidateId);
  const selectCandidate = useStore((s) => s.selectCandidate);
  const showOriginal = useStore((s) => s.showOriginal);

  const pending = session.pending_action;
  const isTargetObs = pending?.type === "RECAPTURE" && pending.reference_obs_id === obs.obs_id;
  const cands = obs.candidates;

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
          <g key={c.id} onClick={(e) => { e.stopPropagation(); selectCandidate(c.id); }} className="cursor-pointer" style={{ pointerEvents: "all" }}>
            {c.polygon && c.type === "suspected_corrosion" && (
              <polygon points={c.polygon.map((p) => p.join(",")).join(" ")} fill={color} fillOpacity={sel ? 0.16 : 0.07} stroke={color} strokeOpacity={0.8} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
            <Brackets x={x} y={y} w={w} h={h} color={color} dashed={c.mapped_only} />
            {sel && <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} fill="none" stroke="#F0F0EB" strokeOpacity={0.9} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            <rect x={x} y={y} width={w} height={h} fill="transparent" />
          </g>
        );
      })}
    </g>
  );

  return (
    <ImageCanvas
      src={apiUrl(obs.capture_url)!}
      width={obs.width}
      height={obs.height}
      layers={rasterLayers}
      svg={svg}
      measure={tool === "measure"}
      pxToOriginal={1 / obs.scale_to_working}
      ariaLabel={`Microscope capture ${obs.obs_id}, ${obs.width} by ${obs.height} pixels, ${cands.length} candidate overlays`}
      onImageClick={() => selectCandidate(null)}
      fitKey={obs.obs_id}
      screen={({ toScreen }) =>
        !showOriginal && layers.candidates && cands.map((c) => {
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
        })
      }
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
      </div>
    </ImageCanvas>
  );
}
