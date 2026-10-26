"""End-to-end agent behaviour through the HTTP API, on synthetic captures with known content."""

import os
import tempfile

os.environ["BOARDGUARD_DATA_DIR"] = tempfile.mkdtemp(prefix="bg-test-")

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.agents import policies
from app.main import app
from tests.synth import jpeg, render_board, warp

client = TestClient(app)
GLARE = {"glare_at": (575, 545), "glare_radius": 45}


def new(mode="inspection"):
    r = client.post("/api/inspections", json={"mode": mode, "board_region": "REGION-B", "board_region_label": "REGION-B"})
    assert r.status_code == 200
    return r.json()


def submit(iid, img, label="test"):
    r = client.post(f"/api/inspections/{iid}/captures", files={"file": (f"{label}.jpg", jpeg(img), "image/jpeg")})
    assert r.status_code == 200, r.text
    return r.json()


def act(iid, **body):
    return client.post(f"/api/inspections/{iid}/actions", json=body)


def tools_called(s):
    return [e["tool"] for e in s["trace"] if e["tool"]]


def test_health_reports_opencv5():
    h = client.get("/api/health").json()
    assert h["opencv_version"].startswith("5.")


def test_blurry_capture_triggers_recapture_not_analysis():
    s = new()
    img, _ = render_board(bridge=True, blur_sigma=4)
    s = submit(s["inspection_id"], img)
    assert s["state"] == "RECAPTURE_REQUESTED"
    assert s["pending_action"]["type"] == "RECAPTURE"
    assert "Refocus" in s["pending_action"]["instruction"]
    assert "detect_visual_candidates" not in tools_called(s)  # bad evidence is never analysed


def test_good_capture_continues_to_review():
    s = new()
    img, _ = render_board(bridge=True)
    s = submit(s["inspection_id"], img)
    assert s["state"] == "TECHNICIAN_REVIEW_REQUIRED"
    assert [f["type"] for f in s["findings"]] == ["suspected_solder_bridge"]
    assert tools_called(s)[:2] == ["assess_image_quality", "detect_visual_candidates"]


def test_glare_reinspection_not_reproduced_lowers_priority():
    s = new()
    iid = s["inspection_id"]
    g, _ = render_board(**GLARE)
    s = submit(iid, g, "glare")
    assert s["state"] == "RECAPTURE_REQUESTED"
    assert s["pending_action"]["rule"] == "R-E1"
    assert "glare" in s["pending_action"]["instruction"].lower()
    clean, _ = render_board()
    moved, _ = warp(clean, seed=2, max_shift=15, max_rot_deg=2)
    s = submit(iid, moved, "diffuse")
    assert s["observations"][-1]["registration"]["status"] == "REGISTERED"
    f = s["findings"][0]
    assert f["status"] == "NOT_REPRODUCED" and f["priority"] == "LOW"
    # Never auto-cleared: the technician still has to decide.
    assert s["state"] == "TECHNICIAN_REVIEW_REQUIRED"
    assert any(e["trigger"] and e["trigger"]["rule"] == "R-M3" for e in s["trace"])


def test_glare_reinspection_persisted_raises_priority():
    s = new()
    iid = s["inspection_id"]
    g, _ = render_board(bridge=True, **GLARE)
    s = submit(iid, g)
    assert s["state"] == "RECAPTURE_REQUESTED"
    clean, _ = render_board(bridge=True)
    moved, _ = warp(clean, seed=7, max_shift=15, max_rot_deg=2)
    s = submit(iid, moved)
    f = s["findings"][0]
    assert f["status"] == "REVIEW_REQUIRED" and f["priority"] == "HIGH"
    assert any(e["trigger"] and e["trigger"]["rule"] == "R-M2" for e in s["trace"])
    r = act(iid, type="candidate_decision", candidate_id=f["id"], decision="confirm", note="bridge visible under diffuse light")
    s = r.json()
    assert s["state"] == "VERIFICATION_PENDING" and s["pending_action"]["type"] == "AFTER_CAPTURE"


def test_unregistrable_recapture_withholds_comparison():
    s = new()
    iid = s["inspection_id"]
    g, _ = render_board(**GLARE)
    submit(iid, g)
    rng = np.random.default_rng(1)
    other = (rng.random((900, 1200, 3)) * 255).astype(np.uint8)
    import cv2
    other = cv2.GaussianBlur(other, (0, 0), 1.2)
    s = submit(iid, other)
    reg = s["observations"][-1]["registration"]
    assert reg["status"] == "FAILED" and reg["homography"] is None
    assert s["observations"][-1]["comparison"]["comparable"] is False
    assert s["state"] in ("RECAPTURE_REQUESTED", "FAILED_SAFELY")


def test_recapture_budget_is_bounded():
    s = new()
    iid = s["inspection_id"]
    img, _ = render_board(blur_sigma=5)
    for _ in range(policies.MAX_RECAPTURES):
        s = submit(iid, img)
        assert s["state"] == "RECAPTURE_REQUESTED"
    s = submit(iid, img)
    assert s["state"] == "FAILED_SAFELY"
    r = client.post(f"/api/inspections/{iid}/captures", files={"file": ("x.jpg", jpeg(img), "image/jpeg")})
    assert r.status_code == 409


def test_before_after_verification_flow_and_report():
    s = new("verification")
    iid = s["inspection_id"]
    before, _ = render_board(bridge=True)
    s = submit(iid, before)
    assert s["pending_action"]["type"] == "AFTER_CAPTURE"
    after, _ = render_board()
    moved, _ = warp(after, seed=3, max_shift=10, max_rot_deg=2)
    s = submit(iid, moved)
    v = s["verification"]
    assert v["registration"]["status"] == "REGISTERED"
    link = v["change"]["candidate_links"][0]
    assert link["visible_change"] and not link["redetected_after"]
    assert s["pending_action"]["type"] == "CONFIRM_VISUAL_CHECKS"
    s = act(iid, type="confirm_visual_checks").json()
    assert s["state"] == "COMPLETED"
    assert "Electrical verification pending" in s["outcome"]["summary"]
    html = client.get(f"/api/inspections/{iid}/report.html").text
    assert "Visual reinspection completed" in html and "Repair successful" not in html
    trace = client.get(f"/api/inspections/{iid}/trace").json()
    assert trace["events"][0]["seq"] == 1


def test_bad_uploads_have_specific_errors():
    s = new()
    r = client.post(f"/api/inspections/{s['inspection_id']}/captures", files={"file": ("a.txt", b"hello", "text/plain")})
    assert r.status_code == 415 and r.json()["error"]["code"] == "UNSUPPORTED_FORMAT"
    r = client.post(f"/api/inspections/{s['inspection_id']}/captures")
    assert r.status_code == 422
    assert client.get("/api/inspections/BG-00000000-XXXX").status_code == 404
    assert client.get("/api/inspections/../../etc").status_code == 404


def test_decisions_require_pending_review():
    s = new()
    r = act(s["inspection_id"], type="candidate_decision", candidate_id="C01", decision="confirm")
    assert r.status_code in (404, 409)


@pytest.mark.parametrize("path", ["/api/agent/tools", "/api/agent/policies", "/api/runtime", "/api/scenarios"])
def test_introspection_endpoints(path):
    assert client.get(path).status_code == 200
