"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, fmtMs, Tooltip } from "@/components/ui";
import { api } from "@/lib/api";
import { useStore, type Workspace } from "@/lib/store";
import { STATE_META } from "@/lib/status";

const TABS: { id: Workspace; label: string; key: string }[] = [
  { id: "inspect", label: "Inspect", key: "1" },
  { id: "board", label: "Board", key: "2" },
  { id: "verify", label: "Verify", key: "3" },
  { id: "evidence", label: "Evidence", key: "4" },
  { id: "system", label: "System", key: "5" },
];

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1.5" y="1.5" width="17" height="17" rx="2" fill="none" stroke="#79ADA0" strokeWidth="1.3" />
        <circle cx="10" cy="10" r="4.2" fill="none" stroke="#F0F0EB" strokeWidth="1.3" />
        <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" stroke="#F0F0EB" strokeWidth="1.3" />
      </svg>
      <span className="mono text-[12.5px] font-medium tracking-[0.2em] text-ink">BOARDGUARD</span>
    </div>
  );
}

function useCameraCount() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return setN(0);
    const update = () => md.enumerateDevices().then((d) => setN(d.filter((x) => x.kind === "videoinput").length)).catch(() => setN(0));
    update();
    md.addEventListener?.("devicechange", update);
    return () => md.removeEventListener?.("devicechange", update);
  }, []);
  return n;
}

export default function TopBar() {
  const workspace = useStore((s) => s.workspace);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const session = useStore((s) => s.session);
  const apiOnline = useStore((s) => s.apiOnline);
  const apiEnv = useStore((s) => s.apiEnv);
  const opencv = useStore((s) => s.opencv);
  const latency = useStore((s) => s.lastLatencyMs);
  const reset = useStore((s) => s.reset);
  const cams = useCameraCount();
  const meta = session ? STATE_META[session.state] ?? { label: session.state, tone: "neutral" as const } : null;
  const cloud = apiEnv?.startsWith("aws");

  return (
    <header className="flex h-11 items-center gap-4 border-b border-line bg-surface pl-3.5 pr-3">
      <Wordmark />
      <div className="h-5 w-px bg-line" />
      <nav aria-label="Workspaces" className="flex items-center gap-0.5">
        {TABS.map((t) => (
          <Tooltip key={t.id} label={t.label} side="bottom" shortcut={t.key}>
            <button
              type="button"
              onClick={() => setWorkspace(t.id)}
              aria-current={workspace === t.id ? "page" : undefined}
              className={`relative h-11 px-2.5 text-[12.5px] transition-colors ${workspace === t.id ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {t.label}
              {workspace === t.id && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-ink" />}
            </button>
          </Tooltip>
        ))}
      </nav>
      <div className="h-5 w-px bg-line" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {session ? (
          <>
            <span className="mono truncate text-[12px] text-ink">{session.inspection_id}</span>
            {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
            <span className="hidden truncate text-[12px] text-muted xl:inline">{session.board_region_label ?? "Unassigned region"}</span>
          </>
        ) : (
          <span className="text-[12px] text-faint">No active inspection</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Tooltip label={apiOnline ? `Vision API online · ${apiEnv} · last call ${fmtMs(latency)}` : "Vision API unreachable"} side="bottom">
          <span className="mono flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className={`h-1.5 w-1.5 rounded-full ${apiOnline ? "bg-teal" : apiOnline === false ? "bg-coral" : "bg-muted"}`} />
            {cloud ? <Icon.Cloud size={13} /> : <Icon.Cpu size={13} />}
            {apiOnline === false ? "API offline" : apiEnv === "aws-lambda" ? "AWS Lambda" : apiEnv ?? "…"}
            {opencv && <span className="text-muted">· OpenCV {opencv}</span>}
          </span>
        </Tooltip>
        <Tooltip label={cams ? `${cams} camera device(s) available for live capture` : "No camera detected; upload or use recorded captures"} side="bottom">
          <span className="mono hidden items-center gap-1.5 text-[11px] text-muted lg:flex">
            <Icon.Camera size={13} />
            {cams == null ? "…" : cams ? `${cams} cam` : "no cam"}
          </span>
        </Tooltip>
        <div className="h-5 w-px bg-line" />
        {session && (
          <>
            <Tooltip label="Open inspection report (printable to PDF)" side="bottom">
              <a href={api.reportUrl(session.inspection_id, "html")} target="_blank" rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong px-2.5 text-[12px] text-ink hover:bg-raised">
                <Icon.Report size={14} /> Report
              </a>
            </Tooltip>
            <Tooltip label="Download report as JSON" side="bottom">
              <a href={api.reportUrl(session.inspection_id, "json")} aria-label="Download JSON report"
                className="grid h-7 w-7 place-items-center rounded-[4px] border border-line text-muted hover:bg-raised hover:text-ink">
                <Icon.Download size={14} />
              </a>
            </Tooltip>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={reset} disabled={!session}>New</Button>
      </div>
    </header>
  );
}
