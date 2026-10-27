import type { Tone } from "@/components/ui";
import type { CandidateType, FindingStatus } from "./api";

export const STATE_META: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: "Awaiting capture", tone: "muted" },
  CAPTURE_RECEIVED: { label: "Capture received", tone: "neutral" },
  QUALITY_ASSESSMENT: { label: "Quality assessment", tone: "neutral" },
  INSPECTION_REQUIRED: { label: "Inspection", tone: "neutral" },
  CANDIDATE_DETECTED: { label: "Candidate found", tone: "amber" },
  EVIDENCE_INSUFFICIENT: { label: "Evidence insufficient", tone: "amber" },
  RECAPTURE_REQUESTED: { label: "Recapture requested", tone: "amber" },
  SECOND_OBSERVATION_RECEIVED: { label: "Second observation", tone: "neutral" },
  COMPARISON_COMPLETE: { label: "Comparison complete", tone: "neutral" },
  TECHNICIAN_REVIEW_REQUIRED: { label: "Technician review", tone: "coral" },
  VERIFICATION_PENDING: { label: "Verification pending", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "teal" },
  FAILED_SAFELY: { label: "Stopped safely", tone: "amber" },
};

export const FINDING_META: Record<FindingStatus, { label: string; short: string; tone: Tone }> = {
  DETECTED: { label: "Detected", short: "detected", tone: "amber" },
  EVIDENCE_INSUFFICIENT: { label: "Evidence insufficient", short: "evidence", tone: "amber" },
  REVIEW_REQUIRED: { label: "Review required", short: "review", tone: "coral" },
  NOT_REPRODUCED: { label: "Not reproduced", short: "not repr.", tone: "muted" },
  UNRESOLVED: { label: "Unresolved", short: "unresolved", tone: "amber" },
  TECHNICIAN_CONFIRMED: { label: "Confirmed by technician", short: "confirmed", tone: "coral" },
  TECHNICIAN_DISMISSED: { label: "Dismissed by technician", short: "dismissed", tone: "teal" },
};

export const TYPE_LABEL: Record<CandidateType, string> = {
  suspected_corrosion: "Suspected corrosion",
  suspected_solder_bridge: "Suspected solder bridge",
};

export const TYPE_SHORT: Record<CandidateType, string> = {
  suspected_corrosion: "corrosion",
  suspected_solder_bridge: "bridge",
};

/** Overlay colour per candidate state: coral for serious suspicion, amber for uncertain, muted for de-prioritised. */
export function candidateColor(status: FindingStatus | undefined, insufficient: boolean): string {
  if (status === "TECHNICIAN_DISMISSED" || status === "NOT_REPRODUCED") return "#9BA7A7";
  if (insufficient || status === "EVIDENCE_INSUFFICIENT" || status === "UNRESOLVED") return "#D8AA68";
  return "#D67C73";
}

/** Human-readable name of the runtime reported by the vision API (X-BoardGuard-Runtime). */
export function envLabel(env: string | null | undefined): string {
  if (!env) return "API";
  return { "aws-lambda": "AWS Lambda", "aws-ecs": "AWS ECS", "aws-lightsail": "AWS Lightsail", vercel: "Vercel", local: "local" }[env] ?? env;
}

export const VERDICT_TONE: Record<string, Tone> = { ACCEPT: "teal", MARGINAL: "amber", REJECT: "coral" };
export const REG_TONE: Record<string, Tone> = { REGISTERED: "teal", WEAK: "amber", FAILED: "coral" };
