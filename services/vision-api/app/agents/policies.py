"""Decision policies for the inspection agent.

Pure functions: they take measured vision outputs and return a decision with
the rule that fired. Keeping them free of I/O makes every transition unit
testable and lets the trace cite the exact rule behind each action.

Safety invariants (tested in tests/test_policies.py):
  * no path clears a candidate without a technician decision;
  * an image that fails the quality gate is never analysed for candidates;
  * a failed registration never produces a region comparison or overlay;
  * the agent requests at most MAX_RECAPTURES additional captures per session.
"""

from __future__ import annotations

MAX_RECAPTURES = 2

RULES = {
    "R-Q1": "Capture failed the quality gate and recapture budget remains: request a better capture.",
    "R-Q2": "Capture failed the quality gate and the recapture budget is exhausted: stop safely as inconclusive.",
    "R-Q3": "Capture passed the quality gate: continue to candidate analysis.",
    "R-N1": "No suspected anomalies localised: technician acknowledgment required (absence of detections is not clearance).",
    "R-E1": "A candidate's local evidence is compromised (glare/blur/exposure): request a targeted recapture instead of deciding.",
    "R-E2": "All candidates have adequate local evidence: request technician review and electrical testing where relevant.",
    "R-E3": "Local evidence still compromised and budget exhausted: escalate as unresolved to the technician.",
    "R-M1": "New observation could not be registered to the previous one: comparison withheld; request recapture of the same field.",
    "R-M2": "Candidate persisted across observations with adequate evidence: raise priority and require technician review.",
    "R-M3": "Candidate not reproduced under adequate evidence: lower visual priority; technician acknowledgment still required.",
    "R-M4": "Candidate still inconclusive after reinspection: request another capture or mark unresolved.",
    "R-V1": "After-repair capture failed the quality gate: request a new after-repair capture before comparing.",
    "R-V2": "Before/after registration failed: withhold change map and overlays.",
    "R-V3": "Before/after registered: visible changes documented; electrical verification remains with the technician.",
    "R-H1": "Technician decision recorded.",
}

RECOMMENDED_CHECKS = {
    "suspected_solder_bridge": "Continuity / resistance check between the adjacent pins with a multimeter (power off); inspect under a second lighting angle.",
    "suspected_corrosion": "Clean with isopropyl alcohol and a soft brush, re-inspect; check continuity of traces and pads under the deposit.",
}


def recapture_instruction(issues: list[dict], region_label: str, candidate_type: str | None = None) -> str:
    codes = [i["code"] for i in issues]
    parts = []
    if "GLARE" in codes:
        parts.append(
            f"Reduce specular glare on {region_label}: switch to diffuse or polarised illumination, or tilt the light "
            "20-30 degrees away from the lens axis")
    if "BLUR" in codes:
        parts.append(f"Refocus on {region_label} until lead and pad edges are crisp; keep the stage still during capture")
    if "UNDEREXPOSED" in codes:
        parts.append("Increase illumination or exposure")
    if "OVEREXPOSED" in codes:
        parts.append("Reduce illumination or exposure to stop highlights clipping")
    if "RESOLUTION" in codes:
        parts.append(f"Increase optical magnification on {region_label} so each lead spans at least 8 pixels")
    if "TOO_SMALL" in codes:
        parts.append("Capture at a higher resolution or magnification")
    if "LOW_CONTRAST" in codes:
        parts.append("Improve contrast (adjust lighting angle or white balance)")
    if not parts:
        parts.append(f"Recapture {region_label} with steady framing")
    text = "; ".join(parts) + ". Keep the same field of view so observations can be registered."
    if candidate_type == "suspected_solder_bridge" and "GLARE" in codes:
        text += " A reflection can currently mimic a bridge between adjacent leads."
    return text


def quality_gate(quality: dict, recaptures_used: int) -> dict:
    if quality["verdict"] == "REJECT":
        issues = [r for r in quality["reasons"] if r["severity"] == "reject"]
        if recaptures_used < MAX_RECAPTURES:
            return {"rule": "R-Q1", "decision": "RECAPTURE", "issues": issues}
        return {"rule": "R-Q2", "decision": "FAIL_SAFE", "issues": issues}
    return {"rule": "R-Q3", "decision": "CONTINUE", "issues": [r for r in quality["reasons"]]}


def evidence_decision(candidates: list[dict], recaptures_used: int) -> dict:
    if not candidates:
        return {"rule": "R-N1", "decision": "ACKNOWLEDGE_NO_FINDINGS", "targets": []}
    weak = [c for c in candidates if not c["evidence_quality"]["sufficient"]]
    if weak and recaptures_used < MAX_RECAPTURES:
        return {"rule": "R-E1", "decision": "RECAPTURE", "targets": [c["id"] for c in weak]}
    if weak:
        return {"rule": "R-E3", "decision": "REVIEW", "targets": [c["id"] for c in candidates], "unresolved": [c["id"] for c in weak]}
    return {"rule": "R-E2", "decision": "REVIEW", "targets": [c["id"] for c in candidates]}


def reinspection_decision(comparison: dict, recaptures_used: int) -> dict:
    if not comparison["comparable"]:
        if recaptures_used < MAX_RECAPTURES:
            return {"rule": "R-M1", "decision": "RECAPTURE", "per_candidate": {}}
        return {"rule": "R-Q2", "decision": "FAIL_SAFE", "per_candidate": {}}
    per = {}
    rules = set()
    for pc in comparison["per_candidate"]:
        if pc["outcome"] == "PERSISTED":
            per[pc["candidate_id"]] = "REVIEW_HIGH"
            rules.add("R-M2")
        elif pc["outcome"] == "NOT_REPRODUCED":
            per[pc["candidate_id"]] = "REVIEW_LOW"
            rules.add("R-M3")
        else:  # STILL_INCONCLUSIVE / OUT_OF_VIEW
            per[pc["candidate_id"]] = "INCONCLUSIVE"
            rules.add("R-M4")
    if "INCONCLUSIVE" in per.values() and recaptures_used < MAX_RECAPTURES:
        return {"rule": "R-M4", "decision": "RECAPTURE", "per_candidate": per}
    rule = "R-M2" if "R-M2" in rules else ("R-M3" if "R-M3" in rules else "R-M4")
    return {"rule": rule, "decision": "REVIEW", "per_candidate": per, "rules_fired": sorted(rules)}


def verification_decision(registration: dict, change: dict | None, candidate_links: list[dict]) -> dict:
    if registration["status"] == "FAILED" or change is None:
        return {"rule": "R-V2", "decision": "WITHHOLD", "summary": "Registration failed; no change map or overlay is shown."}
    changed = [c for c in candidate_links if c["visible_change"]]
    unchanged = [c for c in candidate_links if not c["visible_change"]]
    return {
        "rule": "R-V3",
        "decision": "DOCUMENTED",
        "summary": (f"{len(changed)} candidate region(s) show visible change, {len(unchanged)} show none. "
                    "Visual reinspection completed; electrical verification pending."),
    }
