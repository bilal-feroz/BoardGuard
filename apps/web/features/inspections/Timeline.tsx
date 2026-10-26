"use client";

import { useEffect, useRef } from "react";
import { fmtMs, fmtTime } from "@/components/ui";
import type { TraceEvent } from "@/lib/api";
import { useStore } from "@/lib/store";

function eventTone(e: TraceEvent): string {
  if (e.status === "error") return "#D67C73";
  if (e.kind === "human") return "#F0F0EB";
  if (e.next_state === "TECHNICIAN_REVIEW_REQUIRED") return "#D67C73";
  if (e.status === "warning" || e.next_state === "RECAPTURE_REQUESTED") return "#D8AA68";
  if (e.next_state === "COMPLETED") return "#79ADA0";
  if (e.kind === "tool") return "#79ADA0";
  return "#9BA7A7";
}

function Glyph({ e }: { e: TraceEvent }) {
  const c = eventTone(e);
  if (e.kind === "tool") return <rect x={-3.5} y={-3.5} width={7} height={7} fill="none" stroke={c} strokeWidth={1.4} />;
  if (e.kind === "decision") return <path d="M0,-5 L5,0 L0,5 L-5,0Z" fill={c} />;
  if (e.kind === "action") return <path d="M-4,-4 L5,0 L-4,4Z" fill={c} />;
  if (e.kind === "human") return <circle r={4.5} fill="none" stroke={c} strokeWidth={1.6} />;
  if (e.kind === "error") return <path d="M-4,-4L4,4M4,-4L-4,4" stroke={c} strokeWidth={1.6} />;
  return <circle r={3} fill={c} />;
}

export default function Timeline() {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedEventSeq);
  const selectEvent = useStore((s) => s.selectEvent);
  const busy = useStore((s) => s.busy);
  const scroller = useRef<HTMLDivElement>(null);
  const events = session?.trace ?? [];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-2">
        <span className="label">Inspection history</span>
        <span className="mono text-[10.5px] text-muted">
          {session ? `${events.length} events · ${session.observations.length} observations · recaptures ${session.recaptures_used}/${session.max_recaptures}` : "No inspection running"}
        </span>
      </div>
      <div ref={scroller} className="relative flex-1 overflow-x-auto overflow-y-hidden">
        {events.length === 0 ? (
          <div className="flex h-full items-center px-4 text-[12px] text-faint">Events from the vision tools, agent decisions and technician actions appear here.</div>
        ) : (
          <ol className="relative flex h-full min-w-max items-stretch px-3">
            <div className="pointer-events-none absolute left-3 right-3 top-[29px] h-px bg-line" />
            {events.map((e) => {
              const sel = selected === e.seq;
              const isObs = e.kind === "system" && e.title.startsWith("OBS-");
              return (
                <li key={e.seq} className="enter relative">
                  <button
                    type="button"
                    onClick={() => selectEvent(sel ? null : e.seq)}
                    title={`${e.title}${e.trigger ? ` — ${e.trigger.rule}: ${e.trigger.text}` : ""}`}
                    className={`group flex h-full w-[132px] flex-col items-start rounded-[3px] px-2 pt-1.5 text-left transition-colors ${sel ? "bg-raised" : "hover:bg-panel-2"} ${isObs ? "w-[150px]" : ""}`}
                  >
                    <span className="mono text-[9.5px] text-faint">{fmtTime(e.timestamp)}</span>
                    <svg width="14" height="14" viewBox="-7 -7 14 14" className="my-[3px] bg-surface" aria-hidden="true"><Glyph e={e} /></svg>
                    <span className={`line-clamp-2 text-[11px] leading-[1.3] ${isObs ? "font-medium text-ink" : "text-ink-2"} group-hover:text-ink`}>{e.title}</span>
                    <span className="mono mt-auto pb-1.5 text-[9.5px] text-faint">
                      {e.tool ? e.tool.replaceAll("_", " ") : e.trigger ? e.trigger.rule : e.actor}
                      {e.duration_ms != null ? ` · ${fmtMs(e.duration_ms)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            {busy && (
              <li className="relative flex w-[150px] flex-col px-2 pt-1.5">
                <span className="mono text-[9.5px] text-faint">pending</span>
                <span className="my-[3px] h-[14px] w-[14px] animate-pulse rounded-full border border-muted bg-surface" />
                <span className="text-[11px] text-muted">{busy.label}…</span>
              </li>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
