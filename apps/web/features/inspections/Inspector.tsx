"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, fmtMs, fmtPct, KV, Meter, Panel, SectionTitle, Spinner } from "@/components/ui";
import { API_BASE, api, apiUrl, type Candidate, type Finding, type Observation, type Session } from "@/lib/api";
import { REGIONS } from "@/lib/regions";
import { calibrationKey, recentInspections, useStore } from "@/lib/store";
import { envLabel, FINDING_META, REG_TONE, STATE_META, TYPE_LABEL, VERDICT_TONE } from "@/lib/status";
import { CameraButton, FixtureOption, UploadButton } from "../microscope/CaptureControls";
import { useReconnectCountdown } from "../workspace/TopBar";

export default function Inspector() {
  const session = useStore((s) => s.session);
  if (!session) return <ScenarioPicker />;
  return <SessionInspector session={session} />;
}

function OfflinePanel() {
  const reconnectNow = useStore((s) => s.reconnectNow);
  const reconnect = useStore((s) => s.reconnect);
  const secs = useReconnectCountdown();
  return (
    <Panel className="enter border-l-2 border-l-coral">
      <div className="flex items-center gap-2 text-[13px] font-medium text-coral"><Icon.Alert size={14} /> Vision API unreachable</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
        The workstation cannot reach <span className="mono text-ink">{API_BASE || "this site's /api"}</span>. It reconnects automatically
        {secs != null ? <> (attempt {reconnect?.attempt}, next in <span className="mono">{secs}s</span>)</> : null}; open inspections are kept.
      </p>
      {API_BASE.includes("localhost") && (
        <p className="mono mt-1.5 text-[10.5px] leading-relaxed text-muted">Local: cd services/vision-api &amp;&amp; .venv/Scripts/python -m uvicorn app.main:app --port 8000</p>
      )}
      <Button className="mt-2.5" size="sm" onClick={reconnectNow}><Icon.Refresh size={12} /> Retry now</Button>
    </Panel>
  );
}

function ScenarioPicker() {
  const scenarios = useStore((s) => s.scenarios);
  const startScenario = useStore((s) => s.startScenario);
  const startCustom = useStore((s) => s.startCustom);
  const busy = useStore((s) => s.busy);
  const apiOnline = useStore((s) => s.apiOnline);
  const env = useStore((s) => s.apiEnv);
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const region = REGIONS.find((r) => r.id === selectedRegionId);

  return (
    <div className="enter">
      {apiOnline === false && <OfflinePanel />}
      <Panel>
        <h2 className="text-[15px] font-medium text-ink">Start an inspection</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
          Pick a demonstration scenario or inspect your own capture. Demo captures are recorded images; every analysis runs live
          with OpenCV on the {env ? envLabel(env) : "vision"} service.
        </p>
      </Panel>
      <Panel>
        <SectionTitle>Demonstration scenarios</SectionTitle>
        <div className="flex flex-col gap-2">
          {scenarios.length === 0 && (
            <p className="text-[12px] text-muted">{apiOnline === false ? "Vision API unreachable — scenarios unavailable." : "Loading scenarios…"}</p>
          )}
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!!busy || !apiOnline}
              onClick={() => startScenario(s.id)}
              className={`group rounded-[4px] border p-3 text-left transition-colors hover:border-line-strong hover:bg-raised disabled:opacity-50 ${region?.scenarioId === s.id ? "border-ink/50 bg-panel-2" : "border-line bg-panel-2/50"}`}
            >
              <div className="flex items-baseline gap-2.5">
                <span className="mono text-[11px] text-muted">{s.number}</span>
                <span className="flex-1 text-[13px] font-medium text-ink">{s.title}</span>
                <Icon.Play size={12} className="text-muted group-hover:text-ink" />
              </div>
              <p className="mt-1 pl-[26px] text-[12px] leading-snug text-ink-2">{s.purpose}</p>
              <p className="mono mt-1.5 pl-[26px] text-[10.5px] uppercase tracking-[0.05em] text-muted">{s.region} · {s.mode}</p>
            </button>
          ))}
        </div>
      </Panel>
      <RecentInspections />
      <Panel>
        <SectionTitle>Your own capture</SectionTitle>
        <p className="mb-2.5 text-[12px] text-ink-2">
          {region ? <>Region <span className="mono text-ink">{region.id}</span> selected on the board.</> : "Optionally select a board region first."}{" "}
          Start a session, then upload an image or capture from a USB microscope.
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!!busy || !apiOnline} onClick={() => startCustom("inspection", selectedRegionId)}>New inspection</Button>
          <Button size="sm" variant="ghost" disabled={!!busy || !apiOnline} onClick={() => startCustom("verification", selectedRegionId)}>New before/after</Button>
        </div>
      </Panel>
    </div>
  );
}

function RecentInspections() {
  const openInspection = useStore((s) => s.openInspection);
  const busy = useStore((s) => s.busy);
  const [items, setItems] = useState<Pick<Session, "inspection_id" | "state" | "board_region" | "created_at" | "scenario_id">[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(recentInspections().map((id) => api.get(id).then((r) => r.data).catch(() => null))).then((rs) => {
      if (!cancelled) setItems(rs.filter((x): x is Session => !!x));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!items.length) return null;
  return (
    <Panel>
      <SectionTitle right={<span className="mono text-[10.5px] text-muted">{items.length}</span>}>Recent inspections</SectionTitle>
      <ul className="-mx-1.5">
        {items.map((s) => {
          const meta = STATE_META[s.state] ?? { label: s.state, tone: "neutral" as const };
          return (
            <li key={s.inspection_id}>
              <button type="button" disabled={!!busy} onClick={() => openInspection(s.inspection_id)}
                className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1.5 text-left hover:bg-raised disabled:opacity-50">
                <span className="mono flex-1 truncate text-[11.5px] text-ink">{s.inspection_id}</span>
                <span className="mono text-[10.5px] text-muted">{s.board_region ?? "—"}</span>
                <Badge tone={meta.tone} className="!text-[9.5px]">{meta.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SessionInspector({ session }: { session: Session }) {
  const selectedObsId = useStore((s) => s.selectedObsId);
  const selectedCandidateId = useStore((s) => s.selectedCandidateId);
  const obs = session.observations.find((o) => o.obs_id === selectedObsId) ?? session.observations[session.observations.length - 1];
  const cand = obs?.candidates.find((c) => c.id === selectedCandidateId);
  const finding = session.findings.find((f) => f.id === selectedCandidateId);
  const apiOnline = useStore((s) => s.apiOnline);
  return (
    <div>
      {apiOnline === false && <OfflinePanel />}
      <PendingAction session={session} />
      {cand && finding && <CandidateDetail cand={cand} finding={finding} session={session} obs={obs!} />}
      {obs && <RegionCheckPanel obs={obs} session={session} />}
      {obs && <ObservationQuality obs={obs} />}
      <Findings session={session} />
      <DecisionRecord session={session} />
    </div>
  );
}

function PendingAction({ session }: { session: Session }) {
  const p = session.pending_action;
  const scenarios = useStore((s) => s.scenarios);
  const action = useStore((s) => s.action);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const busy = useStore((s) => s.busy);
  const sc = scenarios.find((s) => s.id === session.scenario_id);
  const meta = STATE_META[session.state] ?? { label: session.state, tone: "neutral" as const };

  if (!p) {
    return (
      <Panel className="enter">
        <div className="flex items-center justify-between">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="mono text-[10.5px] text-muted">{session.inspection_id}</span>
        </div>
        {session.outcome && <p className="mt-2.5 text-[13px] leading-relaxed text-ink">{session.outcome.summary}</p>}
        {session.state === "COMPLETED" && session.verification?.confirmed_by_technician && (
          <div className="mt-3 flex items-center gap-2 rounded-[4px] border border-teal/40 bg-teal-dim/15 px-3 py-2 text-[12px] text-teal">
            <Icon.Check size={14} /> Visual reinspection completed · electrical verification pending
          </div>
        )}
      </Panel>
    );
  }

  const isCapture = p.type === "CAPTURE" || p.type === "RECAPTURE" || p.type === "AFTER_CAPTURE";
  const usedFixtures = new Set(session.observations.map((o) => o.source.fixture_id));
  const options = !sc ? [] : p.type === "CAPTURE" ? [{ fixture_id: sc.initial, hint: "Initial capture for this scenario." }]
    : sc.next_captures.filter((n) => !usedFixtures.has(n.fixture_id));
  const toneBorder = p.type === "TECHNICIAN_REVIEW" ? "border-l-coral" : p.type === "CONFIRM_VISUAL_CHECKS" ? "border-l-teal" : "border-l-amber";
  const title = {
    CAPTURE: "Capture required",
    RECAPTURE: "Agent requests a recapture",
    AFTER_CAPTURE: "After-repair capture",
    TECHNICIAN_REVIEW: "Technician review required",
    CONFIRM_VISUAL_CHECKS: "Confirm visual checks",
  }[p.type];

  return (
    <Panel className={`enter border-l-2 ${toneBorder}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="label !text-ink-2">Next action</span>
        <span className="flex items-center gap-2">
          {p.rule && <span className="mono rounded-[3px] border border-line px-1.5 text-[10.5px] text-muted" title="Policy rule that produced this action">{p.rule}</span>}
          {p.type === "RECAPTURE" && <span className="mono text-[10.5px] text-amber">attempt {p.attempt}/{p.max_attempts}</span>}
        </span>
      </div>
      <h3 className="mt-1.5 text-[14px] font-medium text-ink">{title}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{p.instruction}</p>
      {p.issues && p.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {p.issues.map((i, k) => (
            <li key={k} className="flex gap-2 text-[11.5px] text-ink-2">
              <span className="mono shrink-0 text-amber">{i.code}</span>
              <span className="text-muted">{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {isCapture && (
        <div className="mt-3 space-y-2">
          {options.map((o) => <FixtureOption key={o.fixture_id} fixtureId={o.fixture_id} hint={o.hint} />)}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <UploadButton />
            <CameraButton />
            {p.type === "RECAPTURE" && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => action({ type: "decline_recapture", note: "Recapture not possible" })}>
                Decline
              </Button>
            )}
            {p.type === "AFTER_CAPTURE" && session.mode === "inspection" && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => action({ type: "finalize" })}>Close inspection</Button>
            )}
          </div>
        </div>
      )}
      {p.type === "TECHNICIAN_REVIEW" && (
        <div className="mt-3 space-y-2">
          {p.no_findings ? (
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => action({ type: "acknowledge_no_findings" })}>
              <Icon.Check size={14} /> Acknowledge
            </Button>
          ) : (
            <p className="text-[11.5px] text-muted">Select a finding on the image or in the list to confirm or dismiss it.</p>
          )}
        </div>
      )}
      {p.type === "CONFIRM_VISUAL_CHECKS" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setWorkspace("verify")}><Icon.Compare size={14} /> Open comparison</Button>
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => action({ type: "confirm_visual_checks" })}>
            <Icon.Check size={14} /> Confirm visual checks
          </Button>
        </div>
      )}
    </Panel>
  );
}

function CandidateDetail({ cand, finding, session, obs }: { cand: Candidate; finding: Finding; session: Session; obs: Observation }) {
  const action = useStore((s) => s.action);
  const undoDecision = useStore((s) => s.undoDecision);
  const busy = useStore((s) => s.busy);
  const [note, setNote] = useState("");
  const eq = cand.evidence_quality;
  const meta = FINDING_META[finding.status];
  const canDecide = session.pending_action?.type === "TECHNICIAN_REVIEW" && (session.pending_action.candidate_ids ?? []).includes(finding.id) && !finding.technician;
  const feats = Object.entries(cand.features ?? {}).filter(([k]) => !k.startsWith("cue_"));

  return (
    <Panel className="enter bg-panel-2/40">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[13px] text-ink">{finding.id}</span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="mt-1 text-[13px] text-ink">{TYPE_LABEL[finding.type]}</div>
      <p className="mt-0.5 text-[11.5px] text-muted">Suspected visual anomaly — not an electrical diagnosis.</p>
      <div className="mt-2.5">
        <KV k="Priority" v={finding.priority.toLowerCase()} tone={finding.priority === "HIGH" ? "coral" : finding.priority === "LOW" ? "muted" : undefined} />
        <KV k="Evidence score (heuristic)" v={cand.evidence_score != null ? cand.evidence_score.toFixed(2) : "—"} title="Combination of image measurements; not a calibrated probability" />
        <KV k="Bounding box" v={`${cand.bbox.join(" · ")}`} />
        {eq && (
          <>
            <KV k="Local glare" v={fmtPct(eq.glare_fraction)} tone={eq.glare_fraction >= 0.1 ? "amber" : undefined} />
            <KV k="Local blur metric" v={eq.blur_metric != null ? eq.blur_metric.toFixed(3) : "flat region"} tone={(eq.blur_metric ?? 0) >= 0.5 ? "amber" : undefined} />
            <KV k="Local evidence" v={eq.sufficient ? "sufficient" : "insufficient"} tone={eq.sufficient ? "teal" : "amber"} />
          </>
        )}
      </div>
      {feats.length > 0 && (
        <details className="mt-2 group">
          <summary className="label cursor-pointer list-none !text-[10px] hover:!text-ink">
            <Icon.ChevronRight size={10} className="mr-1 inline transition-transform group-open:rotate-90" />Measurements ({feats.length})
          </summary>
          <div className="mt-1.5 border-l border-line pl-2.5">
            {feats.map(([k, v]) => <KV key={k} k={k.replaceAll("_", " ")} v={String(v)} />)}
          </div>
        </details>
      )}
      {finding.history.length > 1 && (
        <div className="mt-3">
          <div className="label mb-1 !text-[10px]">Observation history</div>
          <ol className="space-y-1">
            {finding.history.map((h, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="mono text-muted">{String(h.obs_id)}</span>
                <span className="mono text-ink-2">{String(h.outcome).replaceAll("_", " ").toLowerCase()}</span>
                {h.glare_after != null && <span className="mono text-muted">glare {fmtPct(h.glare_before as number)} → {fmtPct(h.glare_after as number)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-3 rounded-[4px] border border-line bg-bg/40 px-2.5 py-2">
        <div className="label mb-0.5 !text-[10px]">Recommended technician check</div>
        <p className="text-[12px] leading-snug text-ink-2">{finding.recommended_check}</p>
      </div>
      {canDecide && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="sr-only">Technician note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)"
              className="h-8 w-full rounded-[4px] border border-line bg-bg/60 px-2.5 text-[12px] text-ink placeholder:text-faint focus:border-line-strong" />
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => action({ type: "candidate_decision", candidate_id: finding.id, decision: "confirm", note })}>
              <Icon.Alert size={13} /> Confirm suspicion
            </Button>
            <Button size="sm" disabled={!!busy} onClick={() => action({ type: "candidate_decision", candidate_id: finding.id, decision: "dismiss", note })}>
              <Icon.X size={13} /> Dismiss
            </Button>
          </div>
        </div>
      )}
      {finding.technician && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="mono text-[11px] text-muted">
            Technician {finding.technician.decision}ed {finding.technician.note ? `— “${finding.technician.note}”` : ""}
          </p>
          {session.undoable_decisions?.includes(finding.id) && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => undoDecision(finding.id)} title="Withdraw this decision and return the finding to review">
              <Icon.Refresh size={12} /> Undo
            </Button>
          )}
        </div>
      )}
      <p className="mono mt-2 text-[10px] text-faint">Measured on {obs.obs_id}</p>
    </Panel>
  );
}

function ObservationQuality({ obs }: { obs: Observation }) {
  const q = obs.quality;
  if (!q) return null;
  const m = q.metrics;
  const t = q.thresholds;
  return (
    <Panel>
      <SectionTitle right={<Badge tone={VERDICT_TONE[q.verdict]}>{q.verdict}</Badge>}>Capture quality · {obs.obs_id}</SectionTitle>
      <div className="space-y-2.5">
        <MeterRow label="Blur metric (Crete)" value={m.blur_metric} fmt={(v) => v.toFixed(3)} lo={t.blur_marginal} hi={t.blur_reject} />
        <MeterRow label="Specular glare" value={m.glare_fraction} fmt={(v) => fmtPct(v, 2)} lo={t.glare_marginal} hi={t.glare_reject} />
        <MeterRow label="Clipped highlights" value={m.clipped_bright_fraction} fmt={(v) => fmtPct(v, 2)} lo={t.clipped_bright_marginal} hi={t.clipped_bright_reject} />
      </div>
      <div className="mt-2.5">
        <KV k="Median luminance" v={m.median_luminance.toFixed(0)} />
        <KV k="RMS contrast" v={m.rms_contrast.toFixed(3)} />
        <KV k="Laplacian variance" v={m.laplacian_variance.toFixed(1)} />
        <KV k="Unusable tiles" v={`${q.tiles.unusable_count} / ${q.tiles.count}`} tone={q.tiles.unusable_count ? "amber" : undefined} />
        <KV k="Working / original" v={`${obs.width}×${obs.height} · ${obs.original_width}×${obs.original_height}`} />
        {obs.registration && <KV k="Registration" v={`${obs.registration.status}${obs.registration.inliers ? ` · ${obs.registration.inliers} inliers` : ""}`} tone={REG_TONE[obs.registration.status]} />}
        <KV k="Processing (API)" v={fmtMs(obs.api_processing_ms)} />
      </div>
      {q.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {q.reasons.map((r, i) => (
            <li key={i} className="text-[11.5px] leading-snug">
              <span className={`mono mr-1.5 ${r.severity === "reject" ? "text-coral" : "text-amber"}`}>{r.code}</span>
              <span className="text-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MeterRow({ label, value, lo, hi, fmt }: { label: string; value: number; lo: number; hi: number; fmt: (v: number) => string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-muted">{label}</span>
        <span className="mono text-[12px] text-ink-2">{fmt(value)}</span>
      </div>
      <Meter value={value} lo={lo} hi={hi} label={label} />
    </div>
  );
}

function RegionCheckPanel({ obs, session }: { obs: Observation; session: Session }) {
  const check = useStore((s) => s.regionCheck);
  const busyRect = useStore((s) => s.regionCheckBusy);
  const clear = useStore((s) => s.clearRegionCheck);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const cal = useStore((s) => s.calibrations[calibrationKey(session, obs.obs_id)]);
  const c = check?.obs_id === obs.obs_id ? check : null;
  if (!c && !busyRect) {
    if (tool !== "region") return null;
    return (
      <Panel className="enter">
        <SectionTitle>Region evidence check</SectionTitle>
        <p className="text-[12px] leading-relaxed text-ink-2">
          Drag a rectangle on <span className="mono">{obs.obs_id}</span> to measure glare, focus, exposure and lead resolution inside it — the
          same region-level checks the agent uses before deciding. The check is recorded in the trace and does not change the inspection state.
        </p>
      </Panel>
    );
  }
  if (!c) {
    return (
      <Panel className="enter">
        <SectionTitle right={<Spinner />}>Region evidence check</SectionTitle>
        <p className="mono text-[11.5px] text-muted">Measuring {busyRect!.join(" · ")} …</p>
      </Panel>
    );
  }
  const [, , w, h] = c.rect;
  return (
    <Panel className="enter">
      <SectionTitle right={
        <span className="flex items-center gap-2">
          <Badge tone={c.sufficient ? "teal" : "amber"}>{c.sufficient ? "sufficient" : "insufficient"}</Badge>
          <button type="button" aria-label="Clear region check" onClick={clear} className="text-muted hover:text-ink"><Icon.X size={12} /></button>
        </span>
      }>Region evidence check</SectionTitle>
      <div className="flex gap-3">
        {c.crop_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={apiUrl(c.crop_url)} alt={`Checked region of ${c.obs_id}`} className="h-16 w-20 shrink-0 rounded-[2px] border border-line object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <KV k="Region" v={cal ? `${(w * cal.mmPerPx).toFixed(2)} × ${(h * cal.mmPerPx).toFixed(2)} mm` : `${w} × ${h} px`} />
          <KV k="Glare" v={fmtPct(c.glare_fraction)} tone={c.glare_fraction >= 0.1 ? "amber" : undefined} />
          <KV k="Blur metric" v={c.blur_metric != null ? c.blur_metric.toFixed(3) : "flat region"} tone={(c.blur_metric ?? 0) >= 0.5 ? "amber" : undefined} />
        </div>
      </div>
      <KV k="Mean luminance" v={c.mean_luminance.toFixed(0)} tone={c.mean_luminance < 25 ? "amber" : undefined} />
      <KV k="Lead rows in region" v={c.lead_rows.length ? c.lead_rows.map((r) => `${r.lead_count}×${r.lead_width_px.toFixed(0)} px`).join(", ") : "none"} />
      {cal && c.lead_rows.length > 0 && <KV k="Lead pitch (calibrated)" v={c.lead_rows.map((r) => `${(r.pitch_px * cal.mmPerPx).toFixed(3)} mm`).join(", ")} tone="teal" />}
      <KV k="Original pixels" v={c.rect_original_px.join(" · ")} />
      {c.issues.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {c.issues.map((i, k) => (
            <li key={k} className="text-[11.5px] leading-snug"><span className="mono mr-1.5 text-amber">{i.code}</span><span className="text-muted">{i.detail}</span></li>
          ))}
        </ul>
      )}
      <p className="mono mt-2 text-[10px] text-faint">
        {c.recorded ? "Recorded in the trace" : "Not recorded: inspection is closed"} · {fmtMs(c.duration_ms)} · {tool === "region" ? "drag again to re-check" : ""}
        {tool !== "region" && <button type="button" className="text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setTool("region")}>check another area</button>}
      </p>
    </Panel>
  );
}

function Findings({ session }: { session: Session }) {
  const selectCandidate = useStore((s) => s.selectCandidate);
  const selectObs = useStore((s) => s.selectObs);
  const selected = useStore((s) => s.selectedCandidateId);
  const undoDecision = useStore((s) => s.undoDecision);
  const busy = useStore((s) => s.busy);
  if (!session.findings.length) {
    if (!session.observations.some((o) => o.detection)) return null;
    return (
      <Panel>
        <SectionTitle>Findings</SectionTitle>
        <p className="text-[12px] text-ink-2">No suspected anomalies localised in the analysed field of view. This is not a clearance.</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionTitle right={<span className="mono text-[10.5px] text-muted">{session.findings.length}</span>}>Findings</SectionTitle>
      <ul className="-mx-1.5">
        {session.findings.map((f) => {
          const meta = FINDING_META[f.status];
          const undoable = session.undoable_decisions?.includes(f.id);
          return (
            <li key={f.id} className="flex items-center">
              <button
                type="button"
                onClick={() => { selectObs(f.latest_obs_id); selectCandidate(f.id); }}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-[3px] px-1.5 py-1.5 text-left hover:bg-raised ${selected === f.id ? "bg-raised" : ""}`}
              >
                <span className="mono w-8 text-[12px] text-ink">{f.id}</span>
                <span className="flex-1 truncate text-[12px] text-ink-2">{TYPE_LABEL[f.type]}</span>
                {f.priority === "HIGH" && <span className="mono text-[10px] text-coral">HIGH</span>}
                {f.priority === "LOW" && <span className="mono text-[10px] text-muted">LOW</span>}
                <Badge tone={meta.tone} className="!text-[9.5px]">{meta.short}</Badge>
              </button>
              {undoable && (
                <button type="button" disabled={!!busy} onClick={() => undoDecision(f.id)} aria-label={`Undo decision on ${f.id}`} title="Withdraw this decision"
                  className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-muted hover:bg-raised hover:text-ink disabled:opacity-40">
                  <Icon.Refresh size={12} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function DecisionRecord({ session }: { session: Session }) {
  const decisions = session.trace.filter((e) => e.kind === "decision" || e.kind === "action").slice(-4).reverse();
  const setWorkspace = useStore((s) => s.setWorkspace);
  const selectEvent = useStore((s) => s.selectEvent);
  if (!decisions.length) return null;
  return (
    <Panel className="border-b-0">
      <SectionTitle right={<button type="button" className="mono text-[10.5px] text-muted hover:text-ink" onClick={() => setWorkspace("evidence")}>full trace →</button>}>
        Agent decisions
      </SectionTitle>
      <ol className="space-y-2.5">
        {decisions.map((e, i) => {
          const repeat = i > 0 && decisions[i - 1].trigger?.rule === e.trigger?.rule;
          return (
            <li key={e.seq}>
              <button type="button" className="w-full text-left" onClick={() => { selectEvent(e.seq); setWorkspace("evidence"); }}>
                <div className="flex items-baseline gap-2">
                  {e.trigger && <span className="mono text-[10.5px] text-amber">{e.trigger.rule}</span>}
                  <span className="text-[12px] text-ink">{e.title}</span>
                </div>
                {e.trigger && !repeat && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{e.trigger.text}</p>}
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
