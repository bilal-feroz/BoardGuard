"""Inspection agent: a transparent state machine over real vision tool calls.

The loop is perception -> decision -> action:
  * perception: OpenCV tools (quality, candidates, registration, change maps)
  * decision:   pure policies in policies.py, each citing a rule id
  * action:     request a targeted recapture, request technician review,
                withhold a comparison, or stop safely

Every tool call, decision and human action is appended to the session trace
with timestamps, inputs, the observations that triggered the decision, the
next action and wall-clock duration. The trace is the audit record.
"""

from __future__ import annotations

import secrets
import time
from datetime import datetime, timezone

from ..vision.imageio import decode_image, encode_jpeg
from . import policies, tools
from .policies import MAX_RECAPTURES, RECOMMENDED_CHECKS, RULES

STATES = [
    "CREATED", "CAPTURE_RECEIVED", "QUALITY_ASSESSMENT", "INSPECTION_REQUIRED", "CANDIDATE_DETECTED",
    "EVIDENCE_INSUFFICIENT", "RECAPTURE_REQUESTED", "SECOND_OBSERVATION_RECEIVED", "COMPARISON_COMPLETE",
    "TECHNICIAN_REVIEW_REQUIRED", "VERIFICATION_PENDING", "COMPLETED", "FAILED_SAFELY",
]
TERMINAL = {"COMPLETED", "FAILED_SAFELY"}


class AgentError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _strip(d):
    if isinstance(d, dict):
        return {k: _strip(v) for k, v in d.items() if not str(k).startswith("_")}
    if isinstance(d, list):
        return [_strip(v) for v in d]
    return d


def new_inspection_id() -> str:
    return f"BG-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}"


class Orchestrator:
    def __init__(self, storage, repo):
        self.storage = storage
        self.repo = repo

    # ------------------------------------------------------------------ helpers
    def _event(self, s: dict, *, kind: str, title: str, tool: str | None = None, inputs: dict | None = None,
               observations: dict | None = None, rule: str | None = None, next_action: str | None = None,
               status: str = "ok", duration_ms: float | None = None, actor: str = "agent",
               obs_id: str | None = None, to_state: str | None = None) -> dict:
        ev = {
            "seq": len(s["trace"]) + 1,
            "inspection_id": s["inspection_id"],
            "timestamp": _now(),
            "kind": kind,
            "actor": actor,
            "title": title,
            "state": s["state"],
            "next_state": to_state or s["state"],
            "tool": tool,
            "inputs": inputs or {},
            "observations": observations or {},
            "trigger": None if rule is None else {"rule": rule, "text": RULES.get(rule, "")},
            "next_action": next_action,
            "status": status,
            "duration_ms": duration_ms,
            "obs_id": obs_id,
        }
        s["trace"].append(ev)
        if to_state:
            s["state"] = to_state
        s["updated_at"] = ev["timestamp"]
        return ev

    def _call(self, s: dict, ctx: tools.ToolContext, name: str, title: str, obs_id: str | None, inputs: dict,
              summarize, **kwargs) -> dict:
        out = tools.TOOLS[name](ctx, **kwargs)
        self._event(s, kind="tool", title=title, tool=name, inputs=inputs, observations=summarize(out),
                    duration_ms=out.get("duration_ms"), obs_id=obs_id,
                    status="warning" if out.get("verdict") == "REJECT" or out.get("status") == "FAILED" else "ok")
        return out

    def _region_label(self, s: dict, cands: list[dict] | None = None) -> str:
        base = s.get("board_region_label") or s.get("board_region") or "the inspected region"
        if cands:
            return f"{base} ({', '.join(c['id'] for c in cands)})"
        return base

    def _finding(self, s: dict, cid: str) -> dict | None:
        return next((f for f in s["findings"] if f["id"] == cid), None)

    def _next_candidate_id(self, s: dict) -> str:
        return f"C{len(s['findings']) + 1:02d}"

    def _set_pending(self, s: dict, action: dict | None):
        s["pending_action"] = action

    # ------------------------------------------------------------------ public API
    def create_session(self, mode: str = "inspection", scenario_id: str | None = None, board_region: str | None = None,
                       board_region_label: str | None = None) -> dict:
        if mode not in ("inspection", "verification"):
            raise AgentError("BAD_MODE", "mode must be 'inspection' or 'verification'", 422)
        s = {
            "inspection_id": new_inspection_id(),
            "created_at": _now(),
            "updated_at": _now(),
            "mode": mode,
            "scenario_id": scenario_id,
            "board_region": board_region,
            "board_region_label": board_region_label,
            "state": "CREATED",
            "recaptures_used": 0,
            "max_recaptures": MAX_RECAPTURES,
            "observations": [],
            "findings": [],
            "verification": None,
            "technician_log": [],
            "pending_action": {"type": "CAPTURE", "instruction": "Provide the first capture of the region to inspect."
                               if mode == "inspection" else "Provide the BEFORE capture of the region."},
            "outcome": None,
            "trace": [],
        }
        self._event(s, kind="system", title="Inspection session created", inputs={"mode": mode, "scenario": scenario_id,
                    "board_region": board_region}, next_action="Await capture", actor="system")
        self.repo.save(s)
        return s

    def submit_observation(self, s: dict, data: bytes, source: dict) -> dict:
        if s["state"] in TERMINAL:
            raise AgentError("SESSION_CLOSED", f"Inspection is {s['state']}; start a new inspection.")
        pending = (s.get("pending_action") or {}).get("type")
        if pending not in ("CAPTURE", "RECAPTURE", "AFTER_CAPTURE"):
            raise AgentError("NOT_AWAITING_CAPTURE", f"The agent is waiting for {pending or 'nothing'}, not a capture.")
        decoded = decode_image(data)  # raises ImageError with a specific code
        obs_id = f"OBS-{len(s['observations']) + 1:03d}"
        key = f"captures/{s['inspection_id']}/{obs_id}.jpg"
        self.storage.put(key, encode_jpeg(decoded.image, 92), "image/jpeg")
        role = "after" if pending == "AFTER_CAPTURE" else ("recapture" if pending == "RECAPTURE" else "initial")
        obs = {
            "obs_id": obs_id, "role": role, "capture_key": key, "received_at": _now(),
            "width": decoded.width, "height": decoded.height,
            "original_width": decoded.original_width, "original_height": decoded.original_height,
            "scale_to_working": round(decoded.scale, 5), "format": decoded.format, "bytes": decoded.byte_size,
            "source": source, "quality": None, "detection": None, "candidates": [], "comparison": None,
            "registration": None, "requested_by": s.get("pending_action"),
        }
        s["observations"].append(obs)
        to = "SECOND_OBSERVATION_RECEIVED" if role == "recapture" else "CAPTURE_RECEIVED"
        self._event(s, kind="system", title=f"{obs_id} received ({role})", obs_id=obs_id, actor="technician" if source.get("kind") != "fixture" else "system",
                    inputs={"source": source.get("kind"), "label": source.get("label"), "provenance": source.get("provenance")},
                    observations={"size": f"{decoded.original_width}x{decoded.original_height}",
                                  "working_size": f"{decoded.width}x{decoded.height}", "format": decoded.format},
                    to_state=to, next_action="assess_image_quality")
        ctx = tools.ToolContext(self.storage, s)
        try:
            if role == "after":
                self._run_verification(s, ctx, obs)
            else:
                self._run_inspection(s, ctx, obs)
        except Exception as exc:  # fail safely, keep the trace
            self._event(s, kind="error", title="Processing error - stopped safely", status="error", obs_id=obs_id,
                        observations={"error": f"{type(exc).__name__}: {exc}"}, to_state="FAILED_SAFELY",
                        next_action="Start a new inspection; no conclusion was drawn.")
            self._set_pending(s, None)
            s["outcome"] = {"status": "FAILED_SAFELY", "summary": "Processing error; no conclusion was drawn."}
        self.repo.save(s)
        return s

    # ------------------------------------------------------------------ inspection loop
    def _quality(self, s, ctx, obs) -> dict:
        self._event(s, kind="system", title="Quality assessment started", obs_id=obs["obs_id"], to_state="QUALITY_ASSESSMENT")
        q = self._call(s, ctx, "assess_image_quality", f"Assess capture quality of {obs['obs_id']}", obs["obs_id"],
                       {"observation_id": obs["obs_id"]},
                       lambda o: {"verdict": o["verdict"], "blur_metric": o["metrics"]["blur_metric"],
                                  "glare_fraction": o["metrics"]["glare_fraction"],
                                  "clipped_bright": o["metrics"]["clipped_bright_fraction"],
                                  "median_luminance": o["metrics"]["median_luminance"],
                                  "unusable_tiles": f"{o['tiles']['unusable_count']}/{o['tiles']['count']}",
                                  "reasons": [r["code"] + ":" + r["severity"] for r in o["reasons"]]},
                       observation_id=obs["obs_id"])
        obs["quality"] = _strip(q)
        return q

    def _request_recapture(self, s, obs, rule: str, issues: list[dict], cands: list[dict] | None, role: str = "RECAPTURE"):
        label = self._region_label(s, cands)
        ctype = cands[0]["type"] if cands else None
        instruction = policies.recapture_instruction(issues, label, ctype)
        s["recaptures_used"] += 1
        action = {
            "type": role, "instruction": instruction, "issues": issues, "rule": rule,
            "reference_obs_id": obs["obs_id"],
            "target_candidates": [c["id"] for c in cands] if cands else [],
            "target_bboxes": [c["bbox"] for c in cands] if cands else [],
            "attempt": s["recaptures_used"], "max_attempts": MAX_RECAPTURES,
        }
        self._set_pending(s, action)
        self._event(s, kind="action", title="Recapture requested", tool="request_recapture", rule=rule, obs_id=obs["obs_id"],
                    inputs={"target": label, "issues": [i["code"] for i in issues]},
                    observations={"instruction": instruction, "attempt": f"{s['recaptures_used']}/{MAX_RECAPTURES}"},
                    next_action="Await new capture from technician", to_state="RECAPTURE_REQUESTED")

    def _fail_safe(self, s, obs, rule: str, summary: str):
        self._set_pending(s, None)
        s["outcome"] = {"status": "FAILED_SAFELY", "summary": summary}
        self._event(s, kind="decision", title="Stopped safely - inconclusive", rule=rule, obs_id=obs["obs_id"],
                    observations={"summary": summary}, status="warning", to_state="FAILED_SAFELY",
                    next_action="Technician to inspect manually; no visual conclusion recorded.")

    def _detect(self, s, ctx, obs) -> dict:
        det = self._call(s, ctx, "detect_visual_candidates", f"Localise suspected anomalies in {obs['obs_id']}", obs["obs_id"],
                         {"observation_id": obs["obs_id"], "roi": None},
                         lambda o: {"candidates": len(o["candidates"]),
                                    "by_type": {t: sum(1 for c in o["candidates"] if c["type"] == t)
                                                for t in ("suspected_corrosion", "suspected_solder_bridge")},
                                    "lead_rows": len(o["lead_rows"])},
                         observation_id=obs["obs_id"])
        obs["detection"] = {"lead_rows": det["lead_rows"], "params": det["params"], "layer_keys": det["layer_keys"],
                            "duration_ms": det["duration_ms"]}
        return det

    def _analyze_candidates(self, s, ctx, obs, cands: list[dict]):
        for c in cands:
            self._call(s, ctx, "analyze_candidate_region", f"Check local evidence for {c['id']}", obs["obs_id"],
                       {"observation_id": obs["obs_id"], "candidate_id": c["id"], "bbox": c["bbox"]},
                       lambda o: {"sufficient": o["sufficient"], "glare_fraction": o["glare_fraction"],
                                  "blur_metric": o["blur_metric"], "issues": [i["code"] for i in o["issues"]]},
                       observation_id=obs["obs_id"], candidate=c)

    def _run_inspection(self, s, ctx, obs):
        q = self._quality(s, ctx, obs)
        gate = policies.quality_gate(q, s["recaptures_used"])
        if gate["decision"] == "RECAPTURE":
            self._event(s, kind="decision", title="Capture rejected by quality gate", rule=gate["rule"], obs_id=obs["obs_id"],
                        observations={"issues": [f"{i['code']}: {i['detail']}" for i in gate["issues"]]}, status="warning",
                        next_action="request_recapture")
            self._request_recapture(s, obs, gate["rule"], gate["issues"], None)
            return
        if gate["decision"] == "FAIL_SAFE":
            self._fail_safe(s, obs, gate["rule"], "Capture quality remained unusable after the maximum number of recaptures.")
            return
        self._event(s, kind="decision", title=f"Quality gate passed ({q['verdict']})", rule="R-Q3", obs_id=obs["obs_id"],
                    observations={"notes": [r["detail"] for r in q["reasons"]]}, next_action="detect_visual_candidates",
                    to_state="INSPECTION_REQUIRED")
        prev = next((o for o in reversed(s["observations"][:-1]) if o["quality"] and o["quality"]["verdict"] != "REJECT"
                     and o["role"] != "after" and o["detection"] is not None
                     and not (o.get("comparison") and not o["comparison"]["comparable"])), None)
        det = self._detect(s, ctx, obs)
        if prev is None:
            self._first_observation(s, ctx, obs, det)
        else:
            self._reinspection(s, ctx, prev, obs, det)

    def _first_observation(self, s, ctx, obs, det):
        cands = det["candidates"]
        obs["candidates"] = [_strip(c) for c in cands]
        for c in obs["candidates"]:
            s["findings"].append({
                "id": c["id"], "type": c["type"], "status": "DETECTED", "priority": "NORMAL",
                "latest_obs_id": obs["obs_id"], "bbox": c["bbox"], "evidence_score": c["evidence_score"],
                "history": [{"obs_id": obs["obs_id"], "outcome": "DETECTED", "evidence_quality_sufficient": c["evidence_quality"]["sufficient"]}],
                "recommended_check": RECOMMENDED_CHECKS[c["type"]], "technician": None,
            })
        if cands:
            self._event(s, kind="decision", title=f"{len(cands)} suspected anomal{'y' if len(cands) == 1 else 'ies'} localised",
                        obs_id=obs["obs_id"], to_state="CANDIDATE_DETECTED", next_action="analyze_candidate_region",
                        observations={"candidates": [f"{c['id']} {c['type']} score {c['evidence_score']}" for c in cands]})
            self._analyze_candidates(s, ctx, obs, cands)
        self._evidence_step(s, obs, cands)

    def _evidence_step(self, s, obs, cands: list[dict]):
        if s["mode"] == "verification":
            for f in s["findings"]:
                f["status"] = "REVIEW_REQUIRED"
            self._set_pending(s, {"type": "AFTER_CAPTURE", "reference_obs_id": obs["obs_id"],
                                  "instruction": f"Before-capture analysed. After cleaning or rework, capture the same field of view as {obs['obs_id']}."})
            self._event(s, kind="decision", title="Before-capture recorded", obs_id=obs["obs_id"],
                        observations={"candidates": [c["id"] for c in cands]}, to_state="VERIFICATION_PENDING",
                        next_action="Await after-repair capture")
            return
        dec = policies.evidence_decision(cands, s["recaptures_used"])
        if dec["decision"] == "RECAPTURE":
            weak = [c for c in cands if c["id"] in dec["targets"]]
            issues = {}
            for c in weak:
                for i in c["evidence_quality"]["issues"]:
                    issues.setdefault(i["code"], i)
                f = self._finding(s, c["id"])
                if f:
                    f["status"] = "EVIDENCE_INSUFFICIENT"
            self._event(s, kind="decision", title="Evidence insufficient for a visual decision", rule=dec["rule"], obs_id=obs["obs_id"],
                        observations={c["id"]: [f"{i['code']}: {i['detail']}" for i in c["evidence_quality"]["issues"]] for c in weak},
                        status="warning", to_state="EVIDENCE_INSUFFICIENT", next_action="request_recapture")
            self._request_recapture(s, obs, dec["rule"], list(issues.values()), weak)
            return
        if dec["decision"] == "ACKNOWLEDGE_NO_FINDINGS":
            self._request_review(s, obs, dec["rule"], [], no_findings=True)
            return
        for cid in dec.get("unresolved", []):
            f = self._finding(s, cid)
            if f:
                f["status"] = "UNRESOLVED"
        for cid in dec["targets"]:
            f = self._finding(s, cid)
            if f and f["status"] in ("DETECTED", "EVIDENCE_INSUFFICIENT"):
                f["status"] = "REVIEW_REQUIRED"
        self._request_review(s, obs, dec["rule"], dec["targets"])

    def _request_review(self, s, obs, rule: str, cids: list[str], no_findings: bool = False):
        checks = {cid: self._finding(s, cid)["recommended_check"] for cid in cids if self._finding(s, cid)}
        if no_findings:
            instruction = ("No suspected anomalies were localised in this field of view. This is not a clearance: "
                           "acknowledge, or inspect other regions.")
        else:
            instruction = "Review each finding, confirm or dismiss it, and perform the recommended electrical checks."
        self._set_pending(s, {"type": "TECHNICIAN_REVIEW", "candidate_ids": cids, "instruction": instruction,
                              "recommended_checks": checks, "no_findings": no_findings, "rule": rule})
        self._event(s, kind="action", title="Technician review requested", tool="request_technician_review", rule=rule,
                    obs_id=obs["obs_id"], inputs={"candidate_ids": cids}, observations={"recommended_checks": checks} if checks else {"no_findings": True},
                    to_state="TECHNICIAN_REVIEW_REQUIRED", next_action="Await technician decision")

    def _reinspection(self, s, ctx, prev, obs, det):
        reg = self._call(s, ctx, "register_image_pair", f"Register {obs['obs_id']} to {prev['obs_id']}", obs["obs_id"],
                         {"reference_observation_id": prev["obs_id"], "moving_observation_id": obs["obs_id"]},
                         lambda o: {"status": o["status"], "method": o.get("method"), "inliers": o.get("inliers"),
                                    "inlier_ratio": o.get("inlier_ratio"), "rms_px": o.get("rms_reprojection_px"),
                                    "coverage": o.get("inlier_coverage"), "reasons": o.get("reasons")},
                         reference_observation_id=prev["obs_id"], moving_observation_id=obs["obs_id"])
        obs["registration"] = _strip(reg) | {"reference_obs_id": prev["obs_id"]}
        prev_cands = [c for c in prev["candidates"] if not c.get("unlinked")]
        cmp_ = self._call(s, ctx, "compare_observations", f"Compare candidates across {prev['obs_id']} and {obs['obs_id']}",
                          obs["obs_id"], {"previous_observation_id": prev["obs_id"], "new_observation_id": obs["obs_id"]},
                          lambda o: {"comparable": o["comparable"],
                                     "outcomes": {p["candidate_id"]: p["outcome"] for p in o["per_candidate"]},
                                     "glare_change": {p["candidate_id"]: f"{p.get('glare_before')} -> {p.get('glare_after')}"
                                                      for p in o["per_candidate"] if "glare_after" in p}},
                          previous_observation_id=prev["obs_id"], new_observation_id=obs["obs_id"],
                          prev_candidates=prev_cands, new_detection=det, reg=reg)
        obs["comparison"] = _strip(cmp_)
        self._event(s, kind="system", title="Multi-view comparison complete", obs_id=obs["obs_id"], to_state="COMPARISON_COMPLETE",
                    observations={"registration": reg["status"], "comparable": cmp_["comparable"]})
        new_by_id = {c["id"]: c for c in det["candidates"]}
        if not cmp_["comparable"]:
            # Keep this observation's detections visible but do not link them to earlier findings.
            obs["candidates"] = [_strip(c) | {"id": f"{obs['obs_id']}:{c['id']}", "unlinked": True} for c in det["candidates"]]
            dec = policies.reinspection_decision(cmp_, s["recaptures_used"])
            if dec["decision"] == "RECAPTURE":
                issues = [{"code": "REGISTRATION", "detail": "; ".join(reg.get("reasons", []))}]
                self._event(s, kind="decision", title="Registration failed - comparison withheld", rule="R-M1", obs_id=obs["obs_id"],
                            observations={"reasons": reg.get("reasons")}, status="warning", next_action="request_recapture")
                s["recaptures_used"] += 1
                instruction = (f"Recapture the same field of view as {prev['obs_id']} (similar framing and magnification). "
                               "The new image could not be aligned with the previous one, so no comparison was made.")
                self._set_pending(s, {"type": "RECAPTURE", "instruction": instruction, "issues": issues, "rule": "R-M1",
                                      "reference_obs_id": prev["obs_id"], "target_candidates": [c["id"] for c in prev_cands],
                                      "target_bboxes": [c["bbox"] for c in prev_cands], "attempt": s["recaptures_used"],
                                      "max_attempts": MAX_RECAPTURES})
                self._event(s, kind="action", title="Recapture requested", tool="request_recapture", rule="R-M1", obs_id=obs["obs_id"],
                            observations={"instruction": instruction}, to_state="RECAPTURE_REQUESTED", next_action="Await new capture")
            else:
                self._fail_safe(s, obs, dec["rule"], "Observations could not be registered within the recapture budget; comparison withheld.")
            return
        dec = policies.reinspection_decision(cmp_, s["recaptures_used"])
        linked = []
        for pc in cmp_["per_candidate"]:
            f = self._finding(s, pc["candidate_id"])
            if f is None:
                continue
            verdict = dec["per_candidate"].get(pc["candidate_id"])
            f["history"].append({"obs_id": obs["obs_id"], "outcome": pc["outcome"], "detail": pc["detail"],
                                 "glare_before": pc.get("glare_before"), "glare_after": pc.get("glare_after")})
            f["latest_obs_id"] = obs["obs_id"]
            if pc["outcome"] == "PERSISTED":
                nc = new_by_id[pc["matched_new_candidate"]]
                f.update({"status": "REVIEW_REQUIRED", "priority": "HIGH", "bbox": nc["bbox"], "evidence_score": nc["evidence_score"]})
                linked.append(_strip(nc) | {"id": f["id"], "detection_id": nc["id"], "reinspection_outcome": "PERSISTED"})
            else:
                f["bbox"] = pc["mapped_bbox"]
                if verdict == "REVIEW_LOW":
                    f.update({"status": "NOT_REPRODUCED", "priority": "LOW"})
                else:
                    f["status"] = "EVIDENCE_INSUFFICIENT" if dec["decision"] == "RECAPTURE" else "UNRESOLVED"
                linked.append({"id": f["id"], "type": f["type"], "bbox": pc["mapped_bbox"], "mapped_only": True,
                               "reinspection_outcome": pc["outcome"], "evidence_quality": pc.get("evidence_quality_after"),
                               "polygon": None, "evidence_score": None, "features": {}})
        # New suspected anomalies that were not visible before.
        for nid in cmp_["new_candidates_unmatched"]:
            nc = new_by_id[nid]
            sid = self._next_candidate_id(s)
            s["findings"].append({
                "id": sid, "type": nc["type"], "status": "REVIEW_REQUIRED" if nc["evidence_quality"]["sufficient"] else "UNRESOLVED",
                "priority": "NORMAL", "latest_obs_id": obs["obs_id"], "bbox": nc["bbox"], "evidence_score": nc["evidence_score"],
                "history": [{"obs_id": obs["obs_id"], "outcome": "NEW_IN_REINSPECTION"}],
                "recommended_check": RECOMMENDED_CHECKS[nc["type"]], "technician": None,
            })
            linked.append(_strip(nc) | {"id": sid, "detection_id": nid, "reinspection_outcome": "NEW"})
        obs["candidates"] = linked
        self._event(s, kind="decision", title="Reinspection changed the assessment" if any(
            pc["outcome"] in ("PERSISTED", "NOT_REPRODUCED") for pc in cmp_["per_candidate"]) else "Reinspection still inconclusive",
                    rule=dec["rule"], obs_id=obs["obs_id"],
                    observations={pc["candidate_id"]: f"{pc['outcome']} (glare {pc.get('glare_before')} -> {pc.get('glare_after')})"
                                  for pc in cmp_["per_candidate"]} | ({"new": cmp_["new_candidates_unmatched"]} if cmp_["new_candidates_unmatched"] else {}),
                    next_action="request_recapture" if dec["decision"] == "RECAPTURE" else "request_technician_review")
        if dec["decision"] == "RECAPTURE":
            weak = [c for c in linked if c.get("reinspection_outcome") in ("STILL_INCONCLUSIVE", "OUT_OF_VIEW")]
            issues = {}
            for c in weak:
                for i in (c.get("evidence_quality") or {}).get("issues", []):
                    issues.setdefault(i["code"], i)
            self._request_recapture(s, obs, "R-M4", list(issues.values()) or [{"code": "REFRAME", "detail": "Region not in view"}], weak)
            return
        targets = [f["id"] for f in s["findings"] if f["status"] in ("REVIEW_REQUIRED", "NOT_REPRODUCED", "UNRESOLVED")]
        self._request_review(s, obs, dec["rule"], targets)

    # ------------------------------------------------------------------ before / after verification
    def _run_verification(self, s, ctx, obs):
        q = self._quality(s, ctx, obs)
        gate = policies.quality_gate(q, s["recaptures_used"])
        before = s["observations"][self._before_index(s)]
        if gate["decision"] != "CONTINUE":
            if gate["decision"] == "RECAPTURE":
                self._event(s, kind="decision", title="After-repair capture rejected by quality gate", rule="R-V1", obs_id=obs["obs_id"],
                            observations={"issues": [f"{i['code']}: {i['detail']}" for i in gate["issues"]]}, status="warning")
                self._request_recapture(s, obs, "R-V1", gate["issues"], None, role="AFTER_CAPTURE")
                s["pending_action"]["reference_obs_id"] = before["obs_id"]
                s["state"] = "VERIFICATION_PENDING"
            else:
                self._fail_safe(s, obs, "R-Q2", "After-repair capture quality remained unusable; no comparison made.")
            return
        reg = self._call(s, ctx, "register_image_pair", f"Register after-capture {obs['obs_id']} to before-capture {before['obs_id']}",
                         obs["obs_id"], {"reference_observation_id": before["obs_id"], "moving_observation_id": obs["obs_id"]},
                         lambda o: {"status": o["status"], "method": o.get("method"), "inliers": o.get("inliers"),
                                    "inlier_ratio": o.get("inlier_ratio"), "rms_px": o.get("rms_reprojection_px"),
                                    "coverage": o.get("inlier_coverage"), "reasons": o.get("reasons")},
                         reference_observation_id=before["obs_id"], moving_observation_id=obs["obs_id"])
        obs["registration"] = _strip(reg) | {"reference_obs_id": before["obs_id"]}
        ver = {"before_obs_id": before["obs_id"], "after_obs_id": obs["obs_id"], "registration": obs["registration"],
               "change": None, "decision": None, "confirmed_by_technician": False}
        s["verification"] = ver
        if reg["status"] == "FAILED":
            dec = policies.verification_decision(reg, None, [])
            ver["decision"] = dec
            self._event(s, kind="decision", title="Registration failed - change map withheld", rule="R-V2", obs_id=obs["obs_id"],
                        observations={"reasons": reg.get("reasons")}, status="warning")
            if s["recaptures_used"] < MAX_RECAPTURES:
                self._request_recapture(s, obs, "R-V2", [{"code": "REGISTRATION", "detail": "; ".join(reg.get("reasons", []))}], None,
                                        role="AFTER_CAPTURE")
                s["pending_action"]["instruction"] = (f"Recapture the after-repair image with the same framing and magnification as "
                                                      f"{before['obs_id']}; alignment failed, so no comparison is shown.")
                s["pending_action"]["reference_obs_id"] = before["obs_id"]
                s["state"] = "VERIFICATION_PENDING"
            else:
                self._fail_safe(s, obs, "R-V2", "Before/after images could not be registered; no comparison was made.")
            return
        cands = [c for c in before["candidates"] if not c.get("mapped_only")]
        ch = self._call(s, ctx, "compute_change_map", f"Compute aligned change map {before['obs_id']} -> {obs['obs_id']}", obs["obs_id"],
                        {"before_observation_id": before["obs_id"], "after_observation_id": obs["obs_id"]},
                        lambda o: {"changed_fraction": o["changed_fraction"], "regions": len(o["regions"]),
                                   "threshold": o["threshold"], "valid_overlap": o["valid_overlap_fraction"],
                                   "candidate_links": {c["candidate_id"]: ("changed" if c["visible_change"] else "no visible change")
                                                       + ("; still detected" if c["redetected_after"] else "")
                                                       for c in o["candidate_links"]}},
                        before_observation_id=before["obs_id"], after_observation_id=obs["obs_id"], reg=reg, candidates=cands)
        ver["change"] = _strip(ch)
        dec = policies.verification_decision(reg, ch, ch["candidate_links"])
        ver["decision"] = dec
        for link in ch["candidate_links"]:
            f = self._finding(s, link["candidate_id"])
            if f:
                f["history"].append({"obs_id": obs["obs_id"], "outcome": "VISIBLE_CHANGE" if link["visible_change"] else "NO_VISIBLE_CHANGE",
                                     "changed_fraction": link["changed_fraction_in_bbox"], "redetected_after": link["redetected_after"]})
        self._set_pending(s, {"type": "CONFIRM_VISUAL_CHECKS", "rule": "R-V3",
                              "instruction": "Compare the aligned views, confirm the visual checks, and record electrical verification separately."})
        self._event(s, kind="decision", title="Visible changes documented", rule="R-V3", obs_id=obs["obs_id"],
                    observations={"summary": dec["summary"]}, to_state="VERIFICATION_PENDING",
                    next_action="Technician confirms visual checks; electrical verification pending")

    def _before_index(self, s) -> int:
        # The before image is the most recent acceptable non-after observation with the most findings.
        best, best_n = 0, -1
        for i, o in enumerate(s["observations"]):
            if o["role"] == "after" or not o["quality"] or o["quality"]["verdict"] == "REJECT":
                continue
            n = len([c for c in o["candidates"] if not c.get("mapped_only")])
            if n >= best_n:
                best, best_n = i, n
        return best

    # ------------------------------------------------------------------ human-in-the-loop
    def technician_action(self, s: dict, action: dict) -> dict:
        t = action.get("type")
        note = (action.get("note") or "")[:500]
        pending = (s.get("pending_action") or {}).get("type")
        if s["state"] in TERMINAL:
            raise AgentError("SESSION_CLOSED", f"Inspection is {s['state']}.")
        entry = {"timestamp": _now(), "type": t, "note": note, "actor": "technician (unauthenticated demo user)"}

        if t == "candidate_decision":
            f = self._finding(s, action.get("candidate_id", ""))
            if f is None:
                raise AgentError("UNKNOWN_CANDIDATE", "No such finding.", 404)
            if pending != "TECHNICIAN_REVIEW":
                raise AgentError("NOT_AWAITING_REVIEW", "Findings can be decided once the agent requests review.")
            decision = action.get("decision")
            if decision not in ("confirm", "dismiss"):
                raise AgentError("BAD_DECISION", "decision must be 'confirm' or 'dismiss'", 422)
            f["technician"] = {"decision": decision, "note": note, "timestamp": entry["timestamp"]}
            f["status"] = "TECHNICIAN_CONFIRMED" if decision == "confirm" else "TECHNICIAN_DISMISSED"
            entry.update({"candidate_id": f["id"], "decision": decision})
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title=f"{f['id']} {decision}ed by technician", tool="record_verification",
                        rule="R-H1", inputs={"candidate_id": f["id"], "decision": decision, "note": note})
            open_ = [x for x in s["findings"] if x["id"] in s["pending_action"].get("candidate_ids", []) and x["technician"] is None]
            if not open_:
                self._after_review(s)
        elif t == "acknowledge_no_findings":
            if pending != "TECHNICIAN_REVIEW" or not s["pending_action"].get("no_findings"):
                raise AgentError("NOT_APPLICABLE", "There are findings to review.")
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="No-findings result acknowledged", tool="record_verification", rule="R-H1",
                        inputs={"note": note})
            self._complete(s, "No suspected anomalies localised in the inspected field of view; acknowledged by technician. "
                              "Not a guarantee of absence of defects.")
        elif t == "decline_recapture":
            if pending != "RECAPTURE":
                raise AgentError("NOT_AWAITING_CAPTURE", "No recapture is pending.")
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="Technician declined recapture", rule="R-E3", inputs={"note": note})
            for f in s["findings"]:
                if f["status"] in ("EVIDENCE_INSUFFICIENT", "DETECTED"):
                    f["status"] = "UNRESOLVED"
            obs = s["observations"][-1]
            targets = [f["id"] for f in s["findings"] if f["status"] in ("UNRESOLVED", "REVIEW_REQUIRED", "NOT_REPRODUCED")]
            if targets:
                self._request_review(s, obs, "R-E3", targets)
            else:
                self._fail_safe(s, obs, "R-Q2", "Recapture declined with no usable capture; no visual conclusion recorded.")
        elif t == "request_after_capture":
            if s["state"] not in ("VERIFICATION_PENDING", "TECHNICIAN_REVIEW_REQUIRED") and s["mode"] != "verification":
                raise AgentError("NOT_APPLICABLE", "Before/after verification starts after review.")
            s["technician_log"].append(entry)
            before = s["observations"][self._before_index(s)]
            self._set_pending(s, {"type": "AFTER_CAPTURE", "reference_obs_id": before["obs_id"],
                                  "instruction": f"After cleaning or rework, capture the same field of view as {before['obs_id']}."})
            self._event(s, kind="human", actor="technician", title="Before/after verification started", inputs={"note": note},
                        to_state="VERIFICATION_PENDING", next_action="Await after-repair capture")
        elif t == "confirm_visual_checks":
            if pending != "CONFIRM_VISUAL_CHECKS":
                raise AgentError("NOT_APPLICABLE", "No before/after comparison awaiting confirmation.")
            s["verification"]["confirmed_by_technician"] = True
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="Visual checks confirmed", tool="record_verification", rule="R-H1",
                        inputs={"note": note})
            self._complete(s, "Visual reinspection completed. Visible changes documented. Electrical verification pending.")
        elif t == "record_electrical_result":
            result = (action.get("result") or "").strip()[:300]
            if not result:
                raise AgentError("BAD_INPUT", "result text is required", 422)
            entry.update({"candidate_id": action.get("candidate_id"), "result": result})
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="Electrical measurement recorded (technician-entered)",
                        tool="record_verification", rule="R-H1", inputs={"candidate_id": action.get("candidate_id"), "result": result})
        elif t == "finalize":
            if pending in ("TECHNICIAN_REVIEW",) and any(f["technician"] is None for f in s["findings"]
                                                         if f["id"] in s["pending_action"].get("candidate_ids", [])):
                raise AgentError("REVIEW_INCOMPLETE", "Decide every finding before closing the inspection.")
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="Inspection closed by technician", inputs={"note": note})
            self._complete(s, self._summary(s))
        elif t == "stop":
            s["technician_log"].append(entry)
            self._event(s, kind="human", actor="technician", title="Inspection stopped by technician", inputs={"note": note})
            self._set_pending(s, None)
            s["outcome"] = {"status": "FAILED_SAFELY", "summary": "Stopped by technician; no conclusion recorded."}
            s["state"] = "FAILED_SAFELY"
        else:
            raise AgentError("UNKNOWN_ACTION", f"Unknown action {t!r}", 422)
        self.repo.save(s)
        return s

    def _after_review(self, s):
        confirmed = [f for f in s["findings"] if f["status"] == "TECHNICIAN_CONFIRMED"]
        if confirmed:
            before = s["observations"][self._before_index(s)]
            self._set_pending(s, {"type": "AFTER_CAPTURE", "reference_obs_id": before["obs_id"], "optional": True,
                                  "instruction": (f"Electrical verification pending for {', '.join(f['id'] for f in confirmed)}. "
                                                  f"After cleaning or rework, capture the same field of view as {before['obs_id']} "
                                                  "for before/after verification, or close the inspection.")})
            self._event(s, kind="decision", title="Review complete - verification pending", obs_id=before["obs_id"],
                        observations={"confirmed": [f["id"] for f in confirmed],
                                      "electrical_checks": {f["id"]: f["recommended_check"] for f in confirmed}},
                        to_state="VERIFICATION_PENDING", next_action="After-repair capture or close")
        else:
            self._complete(s, self._summary(s))

    def _summary(self, s) -> str:
        c = sum(1 for f in s["findings"] if f["status"] == "TECHNICIAN_CONFIRMED")
        d = sum(1 for f in s["findings"] if f["status"] == "TECHNICIAN_DISMISSED")
        u = sum(1 for f in s["findings"] if f["technician"] is None)
        parts = [f"{c} finding(s) confirmed visually by technician", f"{d} dismissed"]
        if u:
            parts.append(f"{u} undecided")
        if c:
            parts.append("electrical verification pending")
        return "; ".join(parts) + "."

    def _complete(self, s, summary: str):
        self._set_pending(s, None)
        s["outcome"] = {"status": "COMPLETED", "summary": summary}
        self._event(s, kind="system", title="Inspection completed", observations={"summary": summary}, to_state="COMPLETED",
                    next_action="Export report")
