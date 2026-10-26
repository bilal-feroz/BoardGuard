// Typed client for the BoardGuard vision API.

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path) || path.startsWith("data:")) return path;
  return `${API_BASE}${path}`;
}

export type Rect = [number, number, number, number];
export type Severity = "reject" | "marginal";

export interface QualityReason {
  code: string;
  severity: Severity;
  detail: string;
}

export interface RegionQuality {
  rect: Rect;
  glare_fraction: number;
  glare_fraction_context: number;
  blur_metric: number | null;
  laplacian_variance: number;
  mean_luminance: number;
  sufficient: boolean;
  issues: { code: string; detail: string }[];
}

export interface Quality {
  width: number;
  height: number;
  verdict: "ACCEPT" | "MARGINAL" | "REJECT";
  reasons: QualityReason[];
  metrics: Record<string, number>;
  tiles: {
    grid_px: number;
    count: number;
    judged_for_focus: number;
    unusable_count: number;
    unusable_fraction: number;
    unusable: { x: number; y: number; w: number; h: number; reasons: string[] }[];
  };
  thresholds: Record<string, number>;
  glare_overlay_key?: string;
  glare_overlay_url?: string;
  duration_ms?: number;
}

export type CandidateType = "suspected_corrosion" | "suspected_solder_bridge";

export interface Candidate {
  id: string;
  type: CandidateType;
  bbox: Rect;
  polygon: [number, number][] | null;
  area_px?: number;
  evidence_score: number | null;
  features: Record<string, string | number>;
  evidence_quality?: RegionQuality | null;
  mapped_only?: boolean;
  unlinked?: boolean;
  reinspection_outcome?: string;
  detection_id?: string;
}

export interface Registration {
  status: "REGISTERED" | "WEAK" | "FAILED";
  reasons: string[];
  method?: string;
  ratio_matches?: number;
  inliers?: number;
  inlier_ratio?: number;
  rms_reprojection_px?: number;
  inlier_coverage?: number;
  homography: number[][] | null;
  attempts: Record<string, string | number>[];
  inlier_points_sample?: [number, number][];
  reference_obs_id?: string;
  duration_ms?: number;
  criteria?: Record<string, unknown>;
}

export interface ComparisonEntry {
  candidate_id: string;
  type: CandidateType;
  outcome: "PERSISTED" | "NOT_REPRODUCED" | "STILL_INCONCLUSIVE" | "OUT_OF_VIEW";
  detail: string;
  mapped_bbox: Rect;
  matched_new_candidate?: string | null;
  match_iou?: number | null;
  glare_before?: number | null;
  glare_after?: number | null;
  blur_before?: number | null;
  blur_after?: number | null;
  evidence_score_before?: number | null;
  evidence_score_after?: number | null;
}

export interface Observation {
  obs_id: string;
  role: "initial" | "recapture" | "after";
  capture_key: string;
  capture_url: string;
  received_at: string;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  scale_to_working: number;
  format: string;
  bytes: number;
  source: {
    kind: "fixture" | "upload" | "camera";
    fixture_id?: string;
    label?: string;
    provenance?: string;
    license?: string;
    attribution?: string;
    synthetic?: boolean;
  };
  quality: Quality | null;
  detection: {
    lead_rows: { row: number; lead_count: number; pitch_px: number; lead_width_px: number; lead_length_px: number; angle_deg: number }[];
    layer_keys: Record<string, string>;
    layer_urls?: Record<string, string>;
    duration_ms: number;
  } | null;
  candidates: Candidate[];
  comparison: { comparable: boolean; registration_status: string; reason?: string; per_candidate: ComparisonEntry[]; new_candidates_unmatched?: string[] } | null;
  registration: Registration | null;
  api_processing_ms?: number;
}

export type FindingStatus =
  | "DETECTED"
  | "EVIDENCE_INSUFFICIENT"
  | "REVIEW_REQUIRED"
  | "NOT_REPRODUCED"
  | "UNRESOLVED"
  | "TECHNICIAN_CONFIRMED"
  | "TECHNICIAN_DISMISSED";

export interface Finding {
  id: string;
  type: CandidateType;
  status: FindingStatus;
  priority: "LOW" | "NORMAL" | "HIGH";
  latest_obs_id: string;
  bbox: Rect;
  evidence_score: number | null;
  history: Record<string, unknown>[];
  recommended_check: string;
  technician: { decision: "confirm" | "dismiss"; note: string; timestamp: string } | null;
}

export interface TraceEvent {
  seq: number;
  inspection_id: string;
  timestamp: string;
  kind: "tool" | "decision" | "action" | "human" | "system" | "error";
  actor: "agent" | "technician" | "system";
  title: string;
  state: string;
  next_state: string;
  tool: string | null;
  inputs: Record<string, unknown>;
  observations: Record<string, unknown>;
  trigger: { rule: string; text: string } | null;
  next_action: string | null;
  status: "ok" | "warning" | "error";
  duration_ms: number | null;
  obs_id: string | null;
}

export interface PendingAction {
  type: "CAPTURE" | "RECAPTURE" | "AFTER_CAPTURE" | "TECHNICIAN_REVIEW" | "CONFIRM_VISUAL_CHECKS";
  instruction: string;
  issues?: { code: string; detail: string; severity?: string }[];
  rule?: string;
  reference_obs_id?: string;
  target_candidates?: string[];
  target_bboxes?: Rect[];
  attempt?: number;
  max_attempts?: number;
  candidate_ids?: string[];
  recommended_checks?: Record<string, string>;
  no_findings?: boolean;
  optional?: boolean;
}

export interface ChangeRegion {
  id: string;
  bbox: Rect;
  area_px: number;
  mean_change: number;
  mean_colour_delta_lab: number;
  mean_structural_change: number;
}

export interface Verification {
  before_obs_id: string;
  after_obs_id: string;
  registration: Registration;
  change: {
    threshold: number;
    otsu_threshold: number;
    valid_overlap_fraction: number;
    changed_fraction: number;
    regions: ChangeRegion[];
    aligned_after_url?: string;
    heatmap_url?: string;
    change_mask_url?: string;
    invalid_overlap_url?: string;
    candidate_links: {
      candidate_id: string;
      type: CandidateType;
      bbox: Rect;
      changed_fraction_in_bbox: number;
      changed_px_in_bbox: number;
      visible_change: boolean;
      redetected_after: boolean;
    }[];
    duration_ms?: number;
  } | null;
  decision: { rule: string; decision: string; summary: string } | null;
  confirmed_by_technician: boolean;
}

export interface Session {
  inspection_id: string;
  created_at: string;
  updated_at: string;
  mode: "inspection" | "verification";
  scenario_id: string | null;
  board_region: string | null;
  board_region_label: string | null;
  state: string;
  recaptures_used: number;
  max_recaptures: number;
  observations: Observation[];
  findings: Finding[];
  verification: Verification | null;
  technician_log: Record<string, string>[];
  pending_action: PendingAction | null;
  outcome: { status: string; summary: string } | null;
  trace: TraceEvent[];
  runtime: { environment: string };
}

export interface FixtureMeta {
  label: string;
  provenance: string;
  license?: string;
  attribution?: string;
  source_url?: string;
  synthetic?: boolean;
  url: string;
  width?: number;
  height?: number;
}

export interface ScenarioStep {
  fixture_id: string;
  hint: string;
}

export interface Scenario {
  id: string;
  number: string;
  title: string;
  purpose: string;
  mode: "inspection" | "verification";
  region: string;
  initial: string;
  next_captures: ScenarioStep[];
  notes?: string;
}

export interface Runtime {
  service: string;
  version: string;
  environment: string;
  opencv_version: string;
  opencv_package: string;
  opencv_build: Record<string, string>;
  opencv_threads: number;
  numpy_version: string;
  python_version: string;
  platform: string;
  machine: string;
  cpu_count: number;
  uptime_s: number;
  storage: Record<string, string>;
  aws?: Record<string, string | null>;
  git_sha?: string | null;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<{ data: T; ms: number; env: string | null }> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("NETWORK", "Cannot reach the BoardGuard vision API. Check the connection and that the service is running.", 0);
  }
  const ms = performance.now() - t0;
  if (!res.ok) {
    let code = "HTTP_" + res.status;
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {}
    throw new ApiError(code, message, res.status);
  }
  return { data: (await res.json()) as T, ms, env: res.headers.get("X-BoardGuard-Runtime") };
}

export const api = {
  health: () => call<{ status: string; opencv_version: string; environment: string; storage: string }>("/api/health"),
  runtime: () => call<Runtime>("/api/runtime"),
  tools: () => call<{ tools: { name: string; kind: string; inputs: Record<string, string>; outputs: Record<string, string> }[] }>("/api/agent/tools"),
  policies: () => call<{ rules: Record<string, string>; max_recaptures: number; quality_thresholds: Record<string, number>; registration_criteria: Record<string, unknown>; candidate_params: Record<string, number>; change_params: Record<string, number>; recommended_checks: Record<string, string> }>("/api/agent/policies"),
  scenarios: () => call<{ scenarios: Scenario[]; fixtures: Record<string, FixtureMeta> }>("/api/scenarios"),
  create: (body: { mode: "inspection" | "verification"; scenario_id?: string; board_region?: string; board_region_label?: string }) =>
    call<Session>("/api/inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  get: (id: string) => call<Session>(`/api/inspections/${id}`),
  submitFixture: (id: string, fixtureId: string) => {
    const fd = new FormData();
    fd.append("fixture_id", fixtureId);
    return call<Session>(`/api/inspections/${id}/captures`, { method: "POST", body: fd });
  },
  submitFile: (id: string, file: Blob, name: string, kind: "upload" | "camera") => {
    const fd = new FormData();
    fd.append("file", file, name);
    fd.append("source_kind", kind);
    fd.append("label", name);
    return call<Session>(`/api/inspections/${id}/captures`, { method: "POST", body: fd });
  },
  action: (id: string, body: { type: string; candidate_id?: string; decision?: string; note?: string; result?: string }) =>
    call<Session>(`/api/inspections/${id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  reportUrl: (id: string, fmt: "html" | "json") => `${API_BASE}/api/inspections/${id}/report.${fmt}`,
  traceUrl: (id: string) => `${API_BASE}/api/inspections/${id}/trace`,
};
