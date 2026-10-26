"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, fmtMs, fmtTime, SectionTitle } from "@/components/ui";
import { api, apiUrl, type Session, type TraceEvent } from "@/lib/api";
import { useStore } from "@/lib/store";
import { STATE_META } from "@/lib/status";

type Filter = "all" | "tool" | "decision" | "human";

function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-line bg-bg/60 p-2.5 text-[11px] leading-[1.5] text-ink-2">{text}</pre>;
}

function EvidenceChain({ session }: { session: Session }) {
  const selectEvent = useStore((s) => s.selectEvent);
  // Visual evidence -> decision -> action -> new visual evidence, derived from the real trace.
  const steps = session.trace.filter((e) => e.kind === "decision" || e.kind === "action" || e.kind === "human" || (e.kind === "system" && e.title.startsWith("OBS-")));
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
      {steps.map((e, i) => {
        const isObs = e.title.startsWith("OBS-");
        const obs = isObs ? session.observations.find((o) => o.obs_id === e.obs_id) : null;
        return (
          <div key={e.seq} className="flex items-center">
            <button type="button" onClick={() => selectEvent(e.seq)}
              className={`flex h-[74px] w-[150px] shrink-0 flex-col rounded-[4px] border p-2 text-left hover:border-line-strong ${isObs ? "border-line-strong bg-panel-2" : "border-line bg-panel"}`}>
              <span className="mono text-[9.5px] uppercase tracking-[0.06em] text-muted">
                {isObs ? "visual evidence" : e.kind === "decision" ? "decision" : e.kind === "human" ? "technician" : "action"}
                {e.trigger ? ` · ${e.trigger.rule}` : ""}
              </span>
              <span className="mt-1 line-clamp-2 text-[11.5px] leading-tight text-ink">{e.title}</span>
              {obs?.quality && <span className="mono mt-auto text-[10px] text-ink-2">quality {obs.quality.verdict} · blur {obs.quality.metrics.blur_metric.toFixed(2)} · glare {(obs.quality.metrics.glare_fraction * 100).toFixed(1)}%</span>}
            </button>
            {i < steps.length - 1 && <Icon.ChevronRight size={12} className="mx-1 shrink-0 text-faint" />}
          </div>
        );
      })}
    </div>
  );
}

export default function EvidenceView() {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedEventSeq);
  const selectEvent = useStore((s) => s.selectEvent);
  const [filter, setFilter] = useState<Filter>("all");
  const [tools, setTools] = useState<Record<string, { kind: string; inputs: Record<string, string>; outputs: Record<string, string> }>>({});

  useEffect(() => {
    api.tools().then(({ data }) => setTools(Object.fromEntries(data.tools.map((t) => [t.name, t])))).catch(() => {});
  }, []);

  const events = useMemo(() => (session?.trace ?? []).filter((e) =>
    filter === "all" ? true : filter === "tool" ? e.kind === "tool" : filter === "human" ? e.kind === "human" : e.kind === "decision" || e.kind === "action"), [session, filter]);
  const ev: TraceEvent | undefined = session?.trace.find((e) => e.seq === selected) ?? events[events.length - 1];

  if (!session) {
    return <div className="grid h-full place-items-center text-[13px] text-muted">Start an inspection to see the agent trace.</div>;
  }
  const totalTool = session.trace.filter((e) => e.kind === "tool").reduce((a, e) => a + (e.duration_ms ?? 0), 0);
  const obs = ev?.obs_id ? session.observations.find((o) => o.obs_id === ev.obs_id) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[14px] font-medium">Evidence chain</h2>
            <span className="mono text-[11px] text-muted">{session.inspection_id} · {session.trace.length} events · {session.trace.filter((e) => e.kind === "tool").length} tool calls · {fmtMs(totalTool)} vision compute</span>
          </div>
          <div className="flex gap-2">
            <a href={api.traceUrl(session.inspection_id)} className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong px-2.5 text-[12px] hover:bg-raised"><Icon.Download size={13} /> Trace JSON</a>
            <a href={api.reportUrl(session.inspection_id, "html")} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong px-2.5 text-[12px] hover:bg-raised"><Icon.Report size={13} /> Report</a>
          </div>
        </div>
        <EvidenceChain session={session} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[420px] shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Filter events">
            {(["all", "tool", "decision", "human"] as Filter[]).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={`mono h-6 rounded-[3px] px-2 text-[11px] ${filter === f ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
                {f === "all" ? "all" : f === "tool" ? "tool calls" : f === "decision" ? "decisions" : "human"}
              </button>
            ))}
          </div>
          <ol className="flex-1 overflow-y-auto">
            {events.map((e) => (
              <li key={e.seq}>
                <button type="button" onClick={() => selectEvent(e.seq)}
                  className={`grid w-full grid-cols-[34px_86px_1fr] items-baseline gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-panel-2 ${ev?.seq === e.seq ? "bg-raised" : ""}`}>
                  <span className="mono text-[10.5px] text-faint">#{e.seq}</span>
                  <span className="mono text-[10.5px] text-muted">{fmtTime(e.timestamp)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] text-ink">{e.title}</span>
                    <span className="mono block truncate text-[10.5px] text-muted">
                      {e.kind}{e.tool ? ` · ${e.tool}` : ""}{e.trigger ? ` · ${e.trigger.rule}` : ""}{e.duration_ms != null ? ` · ${fmtMs(e.duration_ms)}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {ev && (
            <div className="enter mx-auto max-w-3xl" key={ev.seq}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-[12px] text-muted">#{ev.seq}</span>
                <Badge tone={ev.status === "error" ? "coral" : ev.status === "warning" ? "amber" : "teal"}>{ev.status}</Badge>
                <span className="mono text-[11px] text-muted">{ev.kind} · {ev.actor}</span>
              </div>
              <h3 className="mt-2 text-[17px] font-medium">{ev.title}</h3>
              <div className="mono mt-1.5 text-[11.5px] text-ink-2">
                {new Date(ev.timestamp).toISOString()} · {STATE_META[ev.state]?.label ?? ev.state} → {STATE_META[ev.next_state]?.label ?? ev.next_state}
                {ev.duration_ms != null ? ` · ${fmtMs(ev.duration_ms)}` : ""}
              </div>
              {ev.trigger && (
                <div className="mt-4 rounded-[4px] border border-amber/35 bg-amber-dim/10 px-3.5 py-2.5">
                  <div className="label !text-amber">Decision trigger · {ev.trigger.rule}</div>
                  <p className="mt-1 text-[13px] text-ink">{ev.trigger.text}</p>
                </div>
              )}
              {ev.next_action && <p className="mt-3 text-[12.5px] text-ink-2"><span className="label mr-2">Next action</span>{ev.next_action}</p>}
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div>
                  <SectionTitle>Inputs</SectionTitle>
                  <Json value={ev.inputs} />
                </div>
                <div>
                  <SectionTitle>Observations / outputs</SectionTitle>
                  <Json value={ev.observations} />
                </div>
              </div>
              {ev.tool && tools[ev.tool] && (
                <div className="mt-5">
                  <SectionTitle right={<span className="mono text-[10.5px] text-muted">{tools[ev.tool].kind}</span>}>Tool contract · {ev.tool}</SectionTitle>
                  <div className="grid gap-3 text-[11.5px] lg:grid-cols-2">
                    {(["inputs", "outputs"] as const).map((k) => (
                      <div key={k} className="rounded-[4px] border border-line p-2.5">
                        <div className="label mb-1 !text-[10px]">{k}</div>
                        {Object.entries(tools[ev.tool!][k]).map(([n, t]) => (
                          <div key={n} className="mono flex justify-between gap-3 py-0.5"><span className="text-ink">{n}</span><span className="text-right text-muted">{t}</span></div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {obs && (
                <div className="mt-5">
                  <SectionTitle>Visual evidence · {obs.obs_id}</SectionTitle>
                  <div className="relative overflow-hidden rounded-[4px] border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={apiUrl(obs.capture_url)} alt={`Capture ${obs.obs_id}`} className="block w-full" />
                    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${obs.width} ${obs.height}`} preserveAspectRatio="none">
                      {obs.candidates.map((c) => (
                        <rect key={c.id} x={c.bbox[0]} y={c.bbox[1]} width={c.bbox[2]} height={c.bbox[3]} fill="none"
                          stroke={c.evidence_quality && !c.evidence_quality.sufficient ? "#D8AA68" : "#D67C73"} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray={c.mapped_only ? "6 4" : undefined} />
                      ))}
                    </svg>
                  </div>
                  <p className="mono mt-1.5 text-[10.5px] text-muted">{obs.source.provenance}</p>
                </div>
              )}
              <div className="mt-6"><Button size="sm" variant="ghost" onClick={() => selectEvent(null)}>Show latest event</Button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
