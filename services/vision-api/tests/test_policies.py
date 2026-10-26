"""Unit tests for the agent's pure decision policies (no images involved)."""

from app.agents import policies as P


def q(verdict, *codes):
    return {"verdict": verdict, "reasons": [{"code": c, "severity": "reject" if verdict == "REJECT" else "marginal", "detail": c} for c in codes]}


def cand(cid, sufficient, issues=()):
    return {"id": cid, "evidence_quality": {"sufficient": sufficient, "issues": [{"code": i, "detail": i} for i in issues]}}


def test_quality_gate_rejects_then_fails_safe_after_budget():
    assert P.quality_gate(q("REJECT", "BLUR"), 0)["rule"] == "R-Q1"
    assert P.quality_gate(q("REJECT", "BLUR"), P.MAX_RECAPTURES)["rule"] == "R-Q2"
    assert P.quality_gate(q("MARGINAL", "GLARE"), 0)["decision"] == "CONTINUE"
    assert P.quality_gate(q("ACCEPT"), 0)["rule"] == "R-Q3"


def test_no_candidates_requires_acknowledgment_not_clearance():
    d = P.evidence_decision([], 0)
    assert d["rule"] == "R-N1" and d["decision"] == "ACKNOWLEDGE_NO_FINDINGS"


def test_insufficient_evidence_requests_targeted_recapture():
    d = P.evidence_decision([cand("C01", False, ["GLARE"]), cand("C02", True)], 0)
    assert d["rule"] == "R-E1" and d["targets"] == ["C01"]


def test_insufficient_evidence_with_no_budget_escalates_unresolved():
    d = P.evidence_decision([cand("C01", False, ["GLARE"])], P.MAX_RECAPTURES)
    assert d["rule"] == "R-E3" and d["decision"] == "REVIEW" and d["unresolved"] == ["C01"]


def test_sufficient_evidence_goes_to_review():
    assert P.evidence_decision([cand("C01", True)], 0)["rule"] == "R-E2"


def test_reinspection_outcomes():
    cmp_ = {"comparable": True, "per_candidate": [
        {"candidate_id": "C01", "outcome": "NOT_REPRODUCED"}, {"candidate_id": "C02", "outcome": "PERSISTED"}]}
    d = P.reinspection_decision(cmp_, 1)
    assert d["decision"] == "REVIEW" and d["per_candidate"] == {"C01": "REVIEW_LOW", "C02": "REVIEW_HIGH"}
    assert set(d["rules_fired"]) == {"R-M2", "R-M3"}


def test_reinspection_inconclusive_requests_again_then_reviews():
    cmp_ = {"comparable": True, "per_candidate": [{"candidate_id": "C01", "outcome": "STILL_INCONCLUSIVE"}]}
    assert P.reinspection_decision(cmp_, 1)["decision"] == "RECAPTURE"
    assert P.reinspection_decision(cmp_, P.MAX_RECAPTURES)["decision"] == "REVIEW"


def test_unregistrable_reinspection_never_compares():
    d = P.reinspection_decision({"comparable": False, "per_candidate": []}, 0)
    assert d["rule"] == "R-M1" and d["decision"] == "RECAPTURE"
    assert P.reinspection_decision({"comparable": False, "per_candidate": []}, P.MAX_RECAPTURES)["decision"] == "FAIL_SAFE"


def test_verification_withholds_on_failed_registration():
    assert P.verification_decision({"status": "FAILED"}, None, [])["rule"] == "R-V2"
    d = P.verification_decision({"status": "REGISTERED"}, {"x": 1}, [{"visible_change": True}, {"visible_change": False}])
    assert d["rule"] == "R-V3"
    assert "electrical verification pending" in d["summary"].lower()
    assert "success" not in d["summary"].lower()


def test_recapture_instructions_are_specific():
    t = P.recapture_instruction([{"code": "GLARE"}], "REGION-B", "suspected_solder_bridge")
    assert "diffuse" in t and "bridge" in t and "same field of view" in t
    assert "magnification" in P.recapture_instruction([{"code": "RESOLUTION"}], "REGION-B")
    assert "Refocus" in P.recapture_instruction([{"code": "BLUR"}], "REGION-B")


def test_every_rule_is_documented():
    for rule in ("R-Q1", "R-Q2", "R-Q3", "R-N1", "R-E1", "R-E2", "R-E3", "R-M1", "R-M2", "R-M3", "R-M4", "R-V1", "R-V2", "R-V3", "R-H1"):
        assert P.RULES[rule]
