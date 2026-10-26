"use client";

import { create } from "zustand";
import { api, ApiError, type FixtureMeta, type Scenario, type Session } from "./api";
import { REGIONS, type RegionStatus } from "./regions";

export type Workspace = "inspect" | "board" | "verify" | "evidence" | "system";
export type Tool = "navigate" | "select" | "measure";
export type CanvasMode = "board" | "microscope";

export interface Layers {
  candidates: boolean;
  glare: boolean;
  tiles: boolean;
  corrosionMask: boolean;
  metalMask: boolean;
  targets: boolean;
}

interface BusyState {
  label: string;
  since: number;
}

interface State {
  workspace: Workspace;
  canvasMode: CanvasMode;
  tool: Tool;
  layers: Layers;
  showOriginal: boolean;

  apiOnline: boolean | null;
  apiEnv: string | null;
  opencv: string | null;

  scenarios: Scenario[];
  fixtures: Record<string, FixtureMeta>;

  session: Session | null;
  history: Session[]; // previous snapshots for undo of view state only
  selectedObsId: string | null;
  selectedCandidateId: string | null;
  selectedEventSeq: number | null;
  selectedRegionId: string | null;
  focusRegionId: string | null;

  busy: BusyState | null;
  error: { code: string; message: string } | null;
  lastLatencyMs: number | null;

  setWorkspace: (w: Workspace) => void;
  setCanvasMode: (m: CanvasMode) => void;
  setTool: (t: Tool) => void;
  toggleLayer: (k: keyof Layers) => void;
  setShowOriginal: (v: boolean) => void;
  selectObs: (id: string | null) => void;
  selectCandidate: (id: string | null) => void;
  selectEvent: (seq: number | null) => void;
  selectRegion: (id: string | null) => void;
  focusRegion: (id: string | null) => void;
  clearError: () => void;

  boot: () => Promise<void>;
  startScenario: (scenarioId: string) => Promise<void>;
  startCustom: (mode: "inspection" | "verification", regionId: string | null) => Promise<void>;
  submitFixture: (fixtureId: string) => Promise<void>;
  submitFile: (file: Blob, name: string, kind: "upload" | "camera") => Promise<void>;
  action: (body: { type: string; candidate_id?: string; decision?: string; note?: string; result?: string }) => Promise<void>;
  reset: () => void;
}

function regionLabel(id: string | null) {
  const r = REGIONS.find((x) => x.id === id);
  return r ? `${r.id} · ${r.label}` : undefined;
}

export const useStore = create<State>((set, get) => {
  const run = async (label: string, fn: () => Promise<{ data: Session; ms: number; env: string | null }>) => {
    set({ busy: { label, since: Date.now() }, error: null });
    try {
      const { data, ms, env } = await fn();
      const last = data.observations[data.observations.length - 1];
      // Surface the evidence behind a recapture request: switch on the layer that shows it.
      const codes = new Set((data.pending_action?.type === "RECAPTURE" ? data.pending_action.issues ?? [] : []).map((i) => i.code));
      if (codes.size) {
        set((s) => ({ layers: { ...s.layers, glare: s.layers.glare || codes.has("GLARE"), tiles: s.layers.tiles || codes.has("BLUR") || codes.has("OVEREXPOSED") || codes.has("UNDEREXPOSED") } }));
      }
      set({
        session: data,
        busy: null,
        lastLatencyMs: ms,
        apiEnv: env ?? get().apiEnv,
        apiOnline: true,
        selectedObsId: last?.obs_id ?? null,
        selectedCandidateId: null,
      });
      return data;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("UNKNOWN", String(e), 0);
      set({ busy: null, error: { code: err.code, message: err.message }, apiOnline: err.code === "NETWORK" ? false : get().apiOnline });
      return null;
    }
  };

  return {
    workspace: "inspect",
    canvasMode: "board",
    tool: "navigate",
    layers: { candidates: true, glare: false, tiles: false, corrosionMask: false, metalMask: false, targets: true },
    showOriginal: false,
    apiOnline: null,
    apiEnv: null,
    opencv: null,
    scenarios: [],
    fixtures: {},
    session: null,
    history: [],
    selectedObsId: null,
    selectedCandidateId: null,
    selectedEventSeq: null,
    selectedRegionId: null,
    focusRegionId: null,
    busy: null,
    error: null,
    lastLatencyMs: null,

    setWorkspace: (workspace) => set({ workspace }),
    setCanvasMode: (canvasMode) => set({ canvasMode }),
    setTool: (tool) => set({ tool }),
    toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
    setShowOriginal: (showOriginal) => set({ showOriginal }),
    selectObs: (selectedObsId) => set({ selectedObsId, selectedCandidateId: null }),
    selectCandidate: (selectedCandidateId) => set({ selectedCandidateId }),
    selectEvent: (selectedEventSeq) => {
      const ev = get().session?.trace.find((e) => e.seq === selectedEventSeq);
      set({ selectedEventSeq, ...(ev?.obs_id ? { selectedObsId: ev.obs_id } : {}) });
    },
    selectRegion: (selectedRegionId) => set({ selectedRegionId }),
    focusRegion: (focusRegionId) => set({ focusRegionId }),
    clearError: () => set({ error: null }),

    boot: async () => {
      try {
        const [h, sc] = await Promise.all([api.health(), api.scenarios()]);
        set({ apiOnline: true, apiEnv: h.data.environment, opencv: h.data.opencv_version, scenarios: sc.data.scenarios, fixtures: sc.data.fixtures });
      } catch (e) {
        const err = e as ApiError;
        set({ apiOnline: false, error: { code: err.code ?? "NETWORK", message: err.message } });
      }
    },

    startScenario: async (scenarioId) => {
      const sc = get().scenarios.find((s) => s.id === scenarioId);
      if (!sc) return;
      set({ selectedRegionId: sc.region, focusRegionId: sc.region, canvasMode: "board", workspace: "inspect", selectedEventSeq: null });
      const created = await run("Creating inspection", () =>
        api.create({ mode: sc.mode, scenario_id: sc.id, board_region: sc.region, board_region_label: regionLabel(sc.region) }),
      );
      if (!created) return;
      await run(`Analysing ${get().fixtures[sc.initial]?.label ?? sc.initial}`, () => api.submitFixture(created.inspection_id, sc.initial));
    },

    startCustom: async (mode, regionId) => {
      set({ selectedEventSeq: null });
      await run("Creating inspection", () =>
        api.create({ mode, board_region: regionId ?? undefined, board_region_label: regionLabel(regionId) }),
      );
    },

    submitFixture: async (fixtureId) => {
      const s = get().session;
      if (!s) return;
      await run(`Analysing ${get().fixtures[fixtureId]?.label ?? fixtureId}`, () => api.submitFixture(s.inspection_id, fixtureId));
      set({ canvasMode: "microscope" });
    },

    submitFile: async (file, name, kind) => {
      const s = get().session;
      if (!s) return;
      await run(`Processing ${name}`, () => api.submitFile(s.inspection_id, file, name, kind));
      set({ canvasMode: "microscope" });
    },

    action: async (body) => {
      const s = get().session;
      if (!s) return;
      const keep = get().selectedObsId;
      await run("Recording decision", () => api.action(s.inspection_id, body));
      set({ selectedObsId: keep });
    },

    reset: () =>
      set({
        session: null,
        selectedObsId: null,
        selectedCandidateId: null,
        selectedEventSeq: null,
        focusRegionId: null,
        canvasMode: "board",
        error: null,
      }),
  };
});

export function regionStatuses(session: Session | null, scenarios: Scenario[]): Record<string, RegionStatus> {
  const out: Record<string, RegionStatus> = {};
  for (const r of REGIONS) out[r.id] = "unvisited";
  if (!session?.board_region) return out;
  const st = session.state;
  let status: RegionStatus = "active";
  if (st === "RECAPTURE_REQUESTED" || st === "EVIDENCE_INSUFFICIENT") status = "attention";
  else if (st === "TECHNICIAN_REVIEW_REQUIRED" && session.findings.some((f) => f.priority === "HIGH" || f.status === "REVIEW_REQUIRED")) status = "critical";
  else if (st === "TECHNICIAN_REVIEW_REQUIRED" || st === "VERIFICATION_PENDING") status = "attention";
  else if (st === "COMPLETED") status = "complete";
  else if (st === "FAILED_SAFELY") status = "attention";
  out[session.board_region] = status;
  void scenarios;
  return out;
}
