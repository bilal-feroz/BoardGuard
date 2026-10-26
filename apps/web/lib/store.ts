"use client";

import { create } from "zustand";
import { api, ApiError, type FixtureMeta, type Rect, type RegionCheck, type Scenario, type Session } from "./api";
import { REGIONS, type RegionStatus } from "./regions";

export type Workspace = "inspect" | "board" | "verify" | "evidence" | "system";
export type Tool = "navigate" | "measure" | "region";
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

/** Physical scale of one capture: millimetres per working-image pixel, and how it was obtained. */
export interface Calibration {
  mmPerPx: number;
  source: string;
}

type SessionCall = () => Promise<{ data: Session; ms: number; env: string | null }>;

interface State {
  workspace: Workspace;
  canvasMode: CanvasMode;
  tool: Tool;
  layers: Layers;
  showOriginal: boolean;

  apiOnline: boolean | null;
  apiEnv: string | null;
  opencv: string | null;
  /** While the API is unreachable: reconnect attempt number and when the next health check runs. */
  reconnect: { attempt: number; nextAt: number } | null;

  scenarios: Scenario[];
  fixtures: Record<string, FixtureMeta>;

  session: Session | null;
  selectedObsId: string | null;
  selectedCandidateId: string | null;
  selectedEventSeq: number | null;
  selectedRegionId: string | null;
  focusRegionId: string | null;

  busy: BusyState | null;
  error: { code: string; message: string } | null;
  /** The request that failed for a network reason, so it can be retried as-is. */
  retry: { label: string; fn: SessionCall } | null;
  lastLatencyMs: number | null;
  /** Most recent technician decision, for the undo toast. */
  lastDecision: { candidateId: string; decision: string; at: number } | null;

  regionCheck: RegionCheck | null;
  regionCheckBusy: Rect | null;
  /** Keyed by `${inspection_id}/${obs_id}`; persisted in this browser only. */
  calibrations: Record<string, Calibration>;

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
  reconnectNow: () => Promise<void>;
  retryLast: () => Promise<void>;
  startScenario: (scenarioId: string) => Promise<void>;
  startCustom: (mode: "inspection" | "verification", regionId: string | null) => Promise<void>;
  submitFixture: (fixtureId: string) => Promise<void>;
  submitFile: (file: Blob, name: string, kind: "upload" | "camera") => Promise<void>;
  action: (body: { type: string; candidate_id?: string; decision?: string; note?: string; result?: string }) => Promise<void>;
  undoDecision: (candidateId: string) => Promise<void>;
  checkRegion: (obsId: string, rect: Rect) => Promise<void>;
  clearRegionCheck: () => void;
  setCalibration: (obsId: string, cal: Calibration | null) => void;
  reset: () => void;
  openInspection: (id: string) => Promise<void>;
}

const RECENT_KEY = "boardguard.recent";
const CAL_KEY = "boardguard.calibrations";
const HEARTBEAT_MS = 30_000;
const NETWORK_CODES = new Set(["NETWORK", "TIMEOUT"]);

export function recentInspections(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberInspection(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentInspections().filter((x) => x !== id)].slice(0, 8)));
  } catch {}
}

function loadCalibrations(): Record<string, Calibration> {
  try {
    return JSON.parse(localStorage.getItem(CAL_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function regionLabel(id: string | null) {
  const r = REGIONS.find((x) => x.id === id);
  return r ? `${r.id} · ${r.label}` : undefined;
}

export function calibrationKey(session: Session | null, obsId: string | null | undefined) {
  return session && obsId ? `${session.inspection_id}/${obsId}` : "";
}

/** Large photos are downscaled in the browser so uploads stay under serverless payload limits (4.5 MB). */
async function shrinkForUpload(file: Blob, name: string): Promise<{ blob: Blob; name: string }> {
  const LIMIT = 3.5 * 1024 * 1024;
  const MAX_SIDE = 2400;
  if (file.size <= LIMIT || !/^image\/(jpeg|png|webp|bmp)$/.test(file.type) || typeof createImageBitmap !== "function") return { blob: file, name };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    return blob ? { blob, name: name.replace(/\.[^.]+$/, "") + ".jpg" } : { blob: file, name };
  } catch {
    return { blob: file, name };
  }
}

let heartbeat: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const scheduleHealth = (delay: number) => {
    if (heartbeat) clearTimeout(heartbeat);
    heartbeat = setTimeout(checkHealth, delay);
  };

  // Offline: back off 1.5 s, 3 s, 6 s, 12 s, then every 15 s. Online: a light heartbeat while the tab is visible.
  const goOffline = () => {
    const attempt = (get().reconnect?.attempt ?? 0) + 1;
    const delay = Math.min(15_000, 1500 * 2 ** (attempt - 1));
    set({ apiOnline: false, reconnect: { attempt, nextAt: Date.now() + delay } });
    scheduleHealth(delay);
  };

  const checkHealth = async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden" && get().apiOnline) {
      scheduleHealth(HEARTBEAT_MS);
      return;
    }
    try {
      const h = await api.health(8000);
      const wasOffline = get().apiOnline === false;
      set({ apiOnline: true, reconnect: null, apiEnv: h.data.environment, opencv: h.data.opencv_version });
      if (wasOffline) await recover();
      scheduleHealth(HEARTBEAT_MS);
    } catch {
      goOffline();
    }
  };

  // After a reconnect: load what boot could not, refresh the open inspection, clear stale network errors.
  const recover = async () => {
    if (!get().scenarios.length) {
      try {
        const sc = await api.scenarios();
        set({ scenarios: sc.data.scenarios, fixtures: sc.data.fixtures });
      } catch {}
    }
    const s = get().session;
    if (s && !get().busy) {
      try {
        const { data } = await api.get(s.inspection_id);
        set({ session: data });
      } catch {}
    }
    if (get().error && NETWORK_CODES.has(get().error!.code)) set({ error: null });
  };

  const run = async (label: string, fn: SessionCall) => {
    set({ busy: { label, since: Date.now() }, error: null });
    try {
      const { data, ms, env } = await fn();
      rememberInspection(data.inspection_id);
      const last = data.observations[data.observations.length - 1];
      // Surface the evidence behind a recapture request: switch on the layer that shows it.
      const codes = new Set((data.pending_action?.type === "RECAPTURE" ? data.pending_action.issues ?? [] : []).map((i) => i.code));
      if (codes.size) {
        set((s) => ({ layers: { ...s.layers, glare: s.layers.glare || codes.has("GLARE"), tiles: s.layers.tiles || codes.has("BLUR") || codes.has("OVEREXPOSED") || codes.has("UNDEREXPOSED") } }));
      }
      set({
        session: data,
        busy: null,
        retry: null,
        lastLatencyMs: ms,
        apiEnv: env ?? get().apiEnv,
        apiOnline: true,
        reconnect: null,
        selectedObsId: last?.obs_id ?? null,
        selectedCandidateId: null,
      });
      return data;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("UNKNOWN", String(e), 0);
      const network = NETWORK_CODES.has(err.code);
      const current = get().session;
      let message = err.message;
      if (err.status === 404 && err.code === "NOT_FOUND" && current) {
        message = `Inspection ${current.inspection_id} is no longer available on the server (serverless storage is temporary). Start a new inspection.`;
      }
      set({ busy: null, error: { code: err.code, message }, retry: network ? { label, fn } : null });
      if (network) goOffline();
      // A state conflict usually means the server moved on (e.g. a response was lost): show the server's view.
      if (err.status === 409 && current) {
        api.get(current.inspection_id).then(({ data }) => set({ session: data })).catch(() => {});
      }
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
    reconnect: null,
    scenarios: [],
    fixtures: {},
    session: null,
    selectedObsId: null,
    selectedCandidateId: null,
    selectedEventSeq: null,
    selectedRegionId: null,
    focusRegionId: null,
    busy: null,
    error: null,
    retry: null,
    lastLatencyMs: null,
    lastDecision: null,
    regionCheck: null,
    regionCheckBusy: null,
    calibrations: {},

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
    clearError: () => set({ error: null, retry: null }),

    boot: async () => {
      set({ calibrations: loadCalibrations() });
      try {
        const [h, sc] = await Promise.all([api.health(), api.scenarios()]);
        set({ apiOnline: true, reconnect: null, apiEnv: h.data.environment, opencv: h.data.opencv_version, scenarios: sc.data.scenarios, fixtures: sc.data.fixtures });
        scheduleHealth(HEARTBEAT_MS);
      } catch (e) {
        const err = e as ApiError;
        set({ error: { code: err.code ?? "NETWORK", message: err.message } });
        goOffline();
      }
    },

    reconnectNow: async () => {
      if (heartbeat) clearTimeout(heartbeat);
      set((s) => ({ reconnect: s.reconnect ? { ...s.reconnect, nextAt: Date.now() } : null }));
      await checkHealth();
    },

    retryLast: async () => {
      const r = get().retry;
      if (!r) return;
      // A previous attempt may have reached the server even though its response was lost.
      const s = get().session;
      if (s) {
        try {
          const { data } = await api.get(s.inspection_id);
          if (data.trace.length !== s.trace.length) {
            set({ session: data, retry: null, error: null, apiOnline: true, selectedObsId: data.observations[data.observations.length - 1]?.obs_id ?? null });
            return;
          }
        } catch {}
      }
      await run(r.label, r.fn);
    },

    startScenario: async (scenarioId) => {
      const sc = get().scenarios.find((s) => s.id === scenarioId);
      if (!sc) return;
      set({ selectedRegionId: sc.region, focusRegionId: sc.region, canvasMode: "board", workspace: "inspect", selectedEventSeq: null, regionCheck: null });
      const created = await run("Creating inspection", () =>
        api.create({ mode: sc.mode, scenario_id: sc.id, board_region: sc.region, board_region_label: regionLabel(sc.region) }),
      );
      if (!created) return;
      await run(`Analysing ${get().fixtures[sc.initial]?.label ?? sc.initial}`, () => api.submitFixture(created.inspection_id, sc.initial));
    },

    startCustom: async (mode, regionId) => {
      set({ selectedEventSeq: null, regionCheck: null });
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
      const up = await shrinkForUpload(file, name);
      await run(`Processing ${name}`, () => api.submitFile(s.inspection_id, up.blob, up.name, kind));
      set({ canvasMode: "microscope" });
    },

    action: async (body) => {
      const s = get().session;
      if (!s) return;
      const keep = get().selectedObsId;
      const data = await run("Recording decision", () => api.action(s.inspection_id, body));
      set({ selectedObsId: keep });
      if (data && body.type === "candidate_decision" && body.candidate_id) {
        set({ lastDecision: { candidateId: body.candidate_id, decision: body.decision ?? "", at: Date.now() } });
        // Move straight on to the next finding that still needs a decision.
        const next = data.findings.find((f) => (data.pending_action?.candidate_ids ?? []).includes(f.id) && !f.technician);
        if (next) set({ selectedObsId: next.latest_obs_id, selectedCandidateId: next.id });
      }
    },

    undoDecision: async (candidateId) => {
      const s = get().session;
      if (!s) return;
      const data = await run(`Withdrawing ${candidateId} decision`, () => api.action(s.inspection_id, { type: "undo_decision", candidate_id: candidateId }));
      if (data) {
        const f = data.findings.find((x) => x.id === candidateId);
        set({ lastDecision: null, selectedObsId: f?.latest_obs_id ?? get().selectedObsId, selectedCandidateId: candidateId });
      }
    },

    checkRegion: async (obsId, rect) => {
      const s = get().session;
      if (!s || get().regionCheckBusy) return;
      set({ regionCheckBusy: rect, error: null });
      try {
        const { data, ms } = await api.regionCheck(s.inspection_id, obsId, rect);
        set({ regionCheck: data.check, session: data.session, regionCheckBusy: null, lastLatencyMs: ms, apiOnline: true });
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("UNKNOWN", String(e), 0);
        set({ regionCheckBusy: null, error: { code: err.code, message: err.message } });
        if (NETWORK_CODES.has(err.code)) goOffline();
      }
    },

    clearRegionCheck: () => set({ regionCheck: null }),

    setCalibration: (obsId, cal) => {
      const key = calibrationKey(get().session, obsId);
      if (!key) return;
      const next = { ...get().calibrations };
      if (cal) next[key] = cal;
      else delete next[key];
      set({ calibrations: next });
      try {
        localStorage.setItem(CAL_KEY, JSON.stringify(next));
      } catch {}
    },

    openInspection: async (id) => {
      set({ regionCheck: null });
      const s = await run("Loading inspection", () => api.get(id));
      if (s) set({ selectedRegionId: s.board_region, focusRegionId: s.board_region, canvasMode: s.observations.length ? "microscope" : "board", workspace: "inspect" });
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
        retry: null,
        lastDecision: null,
        regionCheck: null,
        tool: "navigate",
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
