"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, fmtMs, fmtPct, KV, Panel, SectionTitle } from "@/components/ui";
import { apiUrl, type Observation, type Session, type Verification } from "@/lib/api";
import { useStore } from "@/lib/store";
import { REG_TONE, TYPE_SHORT } from "@/lib/status";
import ImageCanvas, { type View } from "../microscope/ImageCanvas";
import { ErrorToast, ProcessingBar } from "../workspace/MainCanvas";
import { CameraButton, FixtureOption, UploadButton } from "../microscope/CaptureControls";

type Mode = "split" | "side" | "diff";

export default function VerificationView() {
  const session = useStore((s) => s.session);
  const v = session?.verification;
  if (!session || !v) return <EmptyVerification session={session} />;
  const before = session.observations.find((o) => o.obs_id === v.before_obs_id)!;
  const after = session.observations.find((o) => o.obs_id === v.after_obs_id)!;
  return <VerificationWorkspace session={session} v={v} before={before} after={after} />;
}

function EmptyVerification({ session }: { session: Session | null }) {
  const scenarios = useStore((s) => s.scenarios);
  const startScenario = useStore((s) => s.startScenario);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const busy = useStore((s) => s.busy);
  const s03 = scenarios.find((s) => s.mode === "verification");
  const p = session?.pending_action;
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="relative w-full max-w-lg rounded-[6px] border border-line bg-panel p-6">
        <ProcessingBar />
        <div className="label">Before / after verification</div>
        <h2 className="mt-2 text-[17px] font-medium">No registered comparison yet</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          A comparison needs a before capture and an after-repair capture of the same field of view. BoardGuard registers them with
          SIFT + MAGSAC, refuses to overlay them if alignment is unreliable, and maps visible change back to each finding.
        </p>
        {p?.type === "AFTER_CAPTURE" ? (
          <div className="mt-4 space-y-2">
            <p className="text-[12.5px] text-amber">{p.instruction}</p>
            {scenarios.find((s) => s.id === session?.scenario_id)?.next_captures.filter((n) => !session?.observations.some((o) => o.source.fixture_id === n.fixture_id))
              .map((n) => <FixtureOption key={n.fixture_id} fixtureId={n.fixture_id} hint={n.hint} />)}
            <div className="flex gap-2"><UploadButton label="Upload after image" /><CameraButton /></div>
          </div>
        ) : (
          <div className="mt-5 flex gap-2">
            {s03 && <Button variant="primary" disabled={!!busy} onClick={async () => { await startScenario(s03.id); setWorkspace("verify"); }}><Icon.Play size={13} /> Run scenario {s03.number}</Button>}
            {session && <Button onClick={() => setWorkspace("inspect")}>Back to inspection</Button>}
          </div>
        )}
      </div>
      <ErrorToast />
    </div>
  );
}

function SplitView({ before, after, alignedUrl }: { before: Observation; after: Observation; alignedUrl: string }) {
  const [view, setView] = useState<View | null>(null);
  const [pos, setPos] = useState(0.5);
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const onMove = useCallback((clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPos(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  }, []);
  const clipX = view && wrap.current ? (pos * wrap.current.clientWidth - view.tx) / view.s : before.width / 2;
  void after;
  return (
    <div ref={wrap} className="relative h-full w-full">
      <ImageCanvas
        src={apiUrl(before.capture_url)!}
        width={before.width}
        height={before.height}
        view={view}
        onViewChange={setView}
        fitKey={`split-${before.obs_id}`}
        ariaLabel="Before and registered after images with a draggable split"
        layers={[{ src: alignedUrl, key: "after", style: { clipPath: `inset(0 0 0 ${Math.max(0, clipX)}px)` } }]}
        svg={<rect x={0} y={0} width={0} height={0} />}
        hud
      />
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos * 100}%` }}>
        <div className="absolute inset-y-0 -left-px w-[2px] bg-ink/90 shadow-[0_0_0_1px_rgba(0,0,0,.4)]" />
        <button
          type="button"
          aria-label="Drag to compare before and after"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos * 100)}
          onPointerDown={(e) => { e.stopPropagation(); dragging.current = true; (e.target as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => dragging.current && onMove(e.clientX)}
          onPointerUp={() => { dragging.current = false; }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 0.02)); if (e.key === "ArrowRight") setPos((p) => Math.min(1, p + 0.02)); }}
          className="pointer-events-auto absolute top-1/2 -ml-[15px] grid h-8 w-[30px] -translate-y-1/2 cursor-ew-resize place-items-center rounded-[4px] border border-ink bg-bg text-ink"
        >
          <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M5 1L1 5l4 4M9 1l4 4-4 4" stroke="currentColor" fill="none" strokeWidth="1.4" /></svg>
        </button>
      </div>
      <span className="mono pointer-events-none absolute left-3 top-3 rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px]">BEFORE Â· {before.obs_id}</span>
      <span className="mono pointer-events-none absolute right-3 top-3 rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px]">AFTER (registered) Â· {after.obs_id}</span>
    </div>
  );
}

function SideBySide({ before, after, alignedUrl }: { before: Observation; after: Observation; alignedUrl: string | null }) {
  const [view, setView] = useState<View | null>(null);
  return (
    <div className="grid h-full grid-cols-2 gap-px bg-line">
      <div className="relative">
        <ImageCanvas src={apiUrl(before.capture_url)!} width={before.width} height={before.height} view={view} onViewChange={setView} fitKey={`sbs-${before.obs_id}`} ariaLabel="Before image" hud={false} />
        <span className="mono pointer-events-none absolute left-3 top-3 rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px]">BEFORE Â· {before.obs_id}</span>
      </div>
      <div className="relative">
        {alignedUrl ? (
          <ImageCanvas src={alignedUrl} width={before.width} height={before.height} view={view} onViewChange={setView} ariaLabel="After image registered to before" />
        ) : (
          <ImageCanvas src={apiUrl(after.capture_url)!} width={after.width} height={after.height} fitKey={`raw-${after.obs_id}`} ariaLabel="After image, unregistered" />
        )}
        <span className="mono pointer-events-none absolute left-3 top-3 rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px]">
          AFTER Â· {after.obs_id} {alignedUrl ? "Â· registered, zoom synchronised" : "Â· UNREGISTERED"}
        </span>
      </div>
    </div>
  );
}

function DiffView({ before, v }: { before: Observation; v: Verification }) {
  const ch = v.change!;
  const [layer, setLayer] = useState<"heat" | "mask">("heat");
  return (
    <div className="relative h-full">
      <ImageCanvas
        src={apiUrl(before.capture_url)!}
        width={before.width}
        height={before.height}
        fitKey={`diff-${before.obs_id}`}
        ariaLabel="Change map over the before image"
        layers={[
          ...(ch.invalid_overlap_url ? [{ src: apiUrl(ch.invalid_overlap_url)!, key: "inv" }] : []),
          { src: apiUrl(layer === "heat" ? ch.heatmap_url : ch.change_mask_url)!, key: layer },
        ]}
        svg={
          <g>
            {ch.regions.map((r) => (
              <rect key={r.id} x={r.bbox[0]} y={r.bbox[1]} width={r.bbox[2]} height={r.bbox[3]} fill="none" stroke="#D8AA68" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
            ))}
            {ch.candidate_links.map((c) => (
              <rect key={c.candidate_id} x={c.bbox[0]} y={c.bbox[1]} width={c.bbox[2]} height={c.bbox[3]} fill="none" stroke="#F0F0EB" strokeDasharray="6 4" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        }
        screen={({ toScreen }) => (
          <>
            {ch.regions.map((r) => {
              const [x, y] = toScreen(r.bbox[0] + r.bbox[2], r.bbox[1]);
              return <span key={r.id} className="mono absolute rounded-[2px] bg-bg/85 px-1 text-[10px] text-amber" style={{ left: x + 3, top: y }}>{r.id}</span>;
            })}
            {ch.candidate_links.map((c) => {
              const [x, y] = toScreen(c.bbox[0], c.bbox[1] + c.bbox[3]);
              return <span key={c.candidate_id} className="mono absolute rounded-[2px] bg-bg/85 px-1 text-[10px] text-ink" style={{ left: x, top: y + 3 }}>{c.candidate_id} Â· finding</span>;
            })}
          </>
        )}
      />
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className="mono rounded-[3px] border border-line bg-bg/85 px-2 py-0.5 text-[11px]">CHANGE MAP Â· over {before.obs_id}</span>
        <div className="flex overflow-hidden rounded-[3px] border border-line bg-bg/85">
          {(["heat", "mask"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLayer(l)} className={`mono px-2 py-0.5 text-[10.5px] ${layer === l ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
              {l === "heat" ? "magnitude" : "thresholded"}
            </button>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-10 left-3 flex flex-col gap-1 rounded-[3px] border border-line bg-bg/85 px-2.5 py-2 text-[10.5px]">
        <span className="mono flex items-center gap-2 text-ink-2"><span className="inline-block h-2 w-5 bg-gradient-to-r from-transparent to-[#D8AA68]" /> visual change magnitude</span>
        <span className="mono flex items-center gap-2 text-ink-2"><span className="inline-block h-2.5 w-5 border border-amber" /> change region (D##)</span>
        <span className="mono flex items-center gap-2 text-ink-2"><span className="inline-block h-2.5 w-5 border border-dashed border-ink" /> prior finding (C##)</span>
        <span className="mono flex items-center gap-2 text-ink-2"><span className="inline-block h-2.5 w-5 bg-[#191e28]/80" /> outside valid overlap</span>
      </div>
    </div>
  );
}

function VerificationWorkspace({ session, v, before, after }: { session: Session; v: Verification; before: Observation; after: Observation }) {
  const [mode, setMode] = useState<Mode>("split");
  const action = useStore((s) => s.action);
  const busy = useStore((s) => s.busy);
  const reg = v.registration;
  const failed = reg.status === "FAILED" || !v.change;
  const ch = v.change;
  const alignedUrl = ch?.aligned_after_url ? apiUrl(ch.aligned_after_url)! : null;
  const canConfirm = session.pending_action?.type === "CONFIRM_VISUAL_CHECKS";
  const done = v.confirmed_by_technician;

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <div className="flex items-center gap-1" role="tablist" aria-label="Comparison mode">
            {([["split", "Split slider"], ["side", "Side by side"], ["diff", "Difference map"]] as [Mode, string][]).map(([m, l]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={failed && m !== "side"} onClick={() => setMode(m)}
                className={`h-7 rounded-[4px] px-2.5 text-[12px] disabled:opacity-35 ${mode === m || (failed && m === "side") ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="mono text-[11px] text-muted">{before.obs_id} â†’ {after.obs_id} Â· {reg.method ?? "â€”"} + MAGSAC homography</span>
        </div>
        <div className="relative min-h-0 flex-1">
          {failed ? <SideBySide before={before} after={after} alignedUrl={null} />
            : mode === "split" ? <SplitView before={before} after={after} alignedUrl={alignedUrl!} />
              : mode === "side" ? <SideBySide before={before} after={after} alignedUrl={alignedUrl} />
                : <DiffView before={before} v={v} />}
          {failed && (
            <div className="absolute inset-x-0 bottom-0 border-t border-coral/40 bg-panel/95 px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] text-coral"><Icon.Alert size={14} /> Registration failed â€” aligned overlay and change map withheld</div>
              <ul className="mt-1 space-y-0.5">{reg.reasons.map((r, i) => <li key={i} className="mono text-[11px] text-ink-2">{r}</li>)}</ul>
            </div>
          )}
          <ProcessingBar />
          <ErrorToast />
        </div>
      </div>
      <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel">
        <Panel>
          <SectionTitle right={<Badge tone={REG_TONE[reg.status]}>{reg.status}</Badge>}>Registration</SectionTitle>
          <KV k="Method" v={reg.method ?? "â€”"} />
          <KV k="Ratio-test matches" v={reg.ratio_matches ?? "â€”"} />
          <KV k="Inliers (MAGSAC)" v={reg.inliers ?? "â€”"} />
          <KV k="Inlier ratio" v={reg.inlier_ratio != null ? fmtPct(reg.inlier_ratio) : "â€”"} />
          <KV k="RMS reprojection" v={reg.rms_reprojection_px != null ? `${reg.rms_reprojection_px.toFixed(2)} px` : "â€”"} />
          <KV k="Inlier coverage" v={reg.inlier_coverage != null ? fmtPct(reg.inlier_coverage) : "â€”"} />
          <KV k="Keypoints (ref / mov)" v={reg.attempts?.[0] ? `${reg.attempts[0].keypoints_ref} / ${reg.attempts[0].keypoints_mov}` : "â€”"} />
          <KV k="Time" v={fmtMs(reg.duration_ms)} />
          {reg.status !== "FAILED" && reg.reasons.length > 0 && <p className="mt-1.5 text-[11.5px] text-amber">{reg.reasons.join(" ")}</p>}
        </Panel>
        {ch && (
          <Panel>
            <SectionTitle>Visible change</SectionTitle>
            <KV k="Changed (valid overlap)" v={fmtPct(ch.changed_fraction, 2)} />
            <KV k="Valid overlap" v={fmtPct(ch.valid_overlap_fraction)} />
            <KV k="Threshold (Otsu / floor)" v={`${ch.threshold.toFixed(2)}`} />
            <KV k="Change regions" v={ch.regions.length} />
            <div className="label mb-1 mt-3 !text-[10px]">Findings vs. change</div>
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-left text-muted"><th className="py-1 font-normal">Finding</th><th className="font-normal">Changed</th><th className="font-normal">Still detected</th></tr></thead>
              <tbody>
                {ch.candidate_links.map((l) => (
                  <tr key={l.candidate_id} className="border-t border-line">
                    <td className="mono py-1.5 text-ink">{l.candidate_id} <span className="text-muted">{TYPE_SHORT[l.type]}</span></td>
                    <td className={`mono ${l.visible_change ? "text-teal" : "text-amber"}`}>{l.visible_change ? `yes Â· ${fmtPct(l.changed_fraction_in_bbox, 0)}` : "no"}</td>
                    <td className={`mono ${l.redetected_after ? "text-coral" : "text-ink-2"}`}>{l.redetected_after ? "yes" : "no"}</td>
                  </tr>
                ))}
                {ch.candidate_links.length === 0 && <tr><td colSpan={3} className="py-1.5 text-muted">No prior findings in the before capture.</td></tr>}
              </tbody>
            </table>
            {ch.regions.some((r) => !ch.candidate_links.some((l) => overlaps(l.bbox, r.bbox))) && (
              <p className="mt-2 text-[11.5px] text-amber">Some visible change lies outside prior findings â€” review for collateral rework or residue.</p>
            )}
          </Panel>
        )}
        <Panel className="border-b-0">
          <SectionTitle>Technician verification</SectionTitle>
          {v.decision && <p className="text-[12.5px] leading-relaxed text-ink-2">{v.decision.summary}</p>}
          {done ? <CompletionMark /> : canConfirm ? (
            <Button className="mt-3 w-full" variant="primary" disabled={!!busy} onClick={() => action({ type: "confirm_visual_checks" })}>
              <Icon.Check size={14} /> Confirm visual checks
            </Button>
          ) : session.pending_action?.type === "AFTER_CAPTURE" ? (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-amber">{session.pending_action.instruction}</p>
              <div className="flex gap-2"><UploadButton label="Upload after image" /><CameraButton /></div>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">Visible change documents a visual difference only. Electrical verification (continuity, resistance, function) remains with the technician.</p>
        </Panel>
      </aside>
    </div>
  );
}

function overlaps(a: number[], b: number[]) {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

function CompletionMark() {
  return (
    <div className="enter mt-3 rounded-[4px] border border-teal/45 bg-teal-dim/15 p-3">
      <div className="flex items-center gap-2.5 text-teal">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 10.3l2.7 2.7L14.3 7.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ strokeDasharray: 14, strokeDashoffset: 14, animation: "bg-draw 520ms 120ms cubic-bezier(.2,.7,.2,1) forwards" }} />
        </svg>
        <span className="text-[13px] font-medium">Visual reinspection completed</span>
      </div>
      <ul className="mono mt-2 space-y-0.5 pl-[30px] text-[11px] text-ink-2">
        <li>Visible changes documented</li>
        <li className="text-amber">Electrical verification pending</li>
      </ul>
      <style>{`@keyframes bg-draw{to{stroke-dashoffset:0}}`}</style>
    </div>
  );
}
