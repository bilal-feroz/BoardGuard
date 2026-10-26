"use client";

import { useMemo } from "react";
import { BoardExplorer } from "@/features/board-explorer";
import { Icon } from "@/components/icons";
import { Badge, Button, Panel, SectionTitle, type Tone } from "@/components/ui";
import { REGIONS, type RegionStatus } from "@/lib/regions";
import { regionStatuses, useStore } from "@/lib/store";

const STATUS: Record<RegionStatus, { label: string; tone: Tone }> = {
  unvisited: { label: "Not inspected", tone: "muted" },
  active: { label: "In progress", tone: "neutral" },
  attention: { label: "Action needed", tone: "amber" },
  critical: { label: "Review required", tone: "coral" },
  complete: { label: "Inspected", tone: "teal" },
};

export default function BoardWorkspace() {
  const session = useStore((s) => s.session);
  const scenarios = useStore((s) => s.scenarios);
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const selectRegion = useStore((s) => s.selectRegion);
  const focusRegionId = useStore((s) => s.focusRegionId);
  const focusRegion = useStore((s) => s.focusRegion);
  const startScenario = useStore((s) => s.startScenario);
  const startCustom = useStore((s) => s.startCustom);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const busy = useStore((s) => s.busy);
  const statuses = useMemo(() => regionStatuses(session, scenarios), [session, scenarios]);
  const region = REGIONS.find((r) => r.id === selectedRegionId);
  const scenario = scenarios.find((s) => s.id === region?.scenarioId);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <BoardExplorer regions={REGIONS} statuses={statuses} selectedId={selectedRegionId} focusId={focusRegionId}
          onSelect={(id) => selectRegion(id)} />
        <div className="absolute left-4 top-4 flex gap-2">
          <Button size="sm" onClick={() => focusRegion(null)} disabled={!focusRegionId}><Icon.Fit size={13} /> Overview</Button>
          {region && <Button size="sm" onClick={() => focusRegion(region.id)}><Icon.Focus size={13} /> Frame {region.id}</Button>}
        </div>
      </div>
      <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel">
        <Panel>
          <SectionTitle>Inspection regions</SectionTitle>
          <ul className="-mx-1.5">
            {REGIONS.map((r) => {
              const st = STATUS[statuses[r.id] ?? "unvisited"];
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => selectRegion(r.id)} onDoubleClick={() => focusRegion(r.id)}
                    className={`w-full rounded-[3px] px-1.5 py-2 text-left hover:bg-raised ${selectedRegionId === r.id ? "bg-raised" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-[12px] text-ink">{r.id}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-2">{r.label}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        {region && (
          <Panel className="enter border-b-0">
            <div className="mono text-[12px] text-muted">{region.id}</div>
            <h3 className="mt-0.5 text-[15px] font-medium">{region.label}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{region.description}</p>
            <p className="mono mt-2 text-[10.5px] text-faint">board coords u {region.u.toFixed(2)} · v {region.v.toFixed(2)} · representational map</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {scenario ? (
                <Button variant="primary" size="sm" disabled={!!busy} onClick={() => { setWorkspace("inspect"); startScenario(scenario.id); }}>
                  <Icon.Scope size={13} /> Inspect · scenario {scenario.number}
                </Button>
              ) : (
                <Button size="sm" disabled={!!busy} onClick={() => { setWorkspace("inspect"); startCustom("inspection", region.id); }}>
                  <Icon.Scope size={13} /> Inspect with own capture
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => focusRegion(region.id)}>Frame region</Button>
            </div>
          </Panel>
        )}
      </aside>
    </div>
  );
}
