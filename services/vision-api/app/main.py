"""BoardGuard vision API (FastAPI + OpenCV 5)."""

from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from .agents.orchestrator import AgentError, Orchestrator
from .agents.policies import MAX_RECAPTURES, RECOMMENDED_CHECKS, RULES
from .agents.tools import TOOL_CONTRACTS
from .reports import report
from .runtime import environment, runtime_info
from .storage.store import SessionRepo, make_storage
from .vision import candidates as cand_mod
from .vision import differences, quality, registration
from .vision.imageio import MAX_UPLOAD_BYTES, ImageError, decode_image

log = logging.getLogger("boardguard")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

FIXTURES_DIR = Path(os.environ.get("BOARDGUARD_FIXTURES_DIR", Path(__file__).resolve().parents[3] / "datasets" / "fixtures"))
API_KEY = os.environ.get("BOARDGUARD_API_KEY")
RATE_PER_MIN = int(os.environ.get("BOARDGUARD_RATE_PER_MIN", 90))

storage = make_storage()
repo = SessionRepo(storage)
agent = Orchestrator(storage, repo)

app = FastAPI(title="BoardGuard Vision API", version="0.1.0",
              description="OpenCV 5 inspection tools and an agentic reinspection loop for PCB repair imagery.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("BOARDGUARD_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-BoardGuard-Key"],
    expose_headers=["X-BoardGuard-Runtime", "X-Process-Time-Ms"],
)

_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def guard(request: Request, call_next):
    t0 = time.perf_counter()
    if request.method == "POST":
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
        q = _hits[ip]
        now = time.time()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_PER_MIN:
            return JSONResponse({"error": {"code": "RATE_LIMITED", "message": "Too many requests; slow down."}}, status_code=429)
        q.append(now)
        if API_KEY and request.headers.get("x-boardguard-key") != API_KEY:
            return JSONResponse({"error": {"code": "UNAUTHORIZED", "message": "Missing or invalid X-BoardGuard-Key."}}, status_code=401)
        cl = request.headers.get("content-length")
        if cl and int(cl) > MAX_UPLOAD_BYTES * 2 + 65536:
            return JSONResponse({"error": {"code": "FILE_TOO_LARGE", "message": "Request body too large."}}, status_code=413)
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    response.headers["X-Process-Time-Ms"] = f"{ms:.1f}"
    response.headers["X-BoardGuard-Runtime"] = environment()
    if request.method == "POST":
        log.info("request %s %s status=%s ms=%.1f env=%s", request.method, request.url.path, response.status_code, ms, environment())
    return response


def _err(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@app.exception_handler(HTTPException)
async def http_exc(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(ImageError)
async def image_exc(_: Request, exc: ImageError):
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=415 if exc.code == "UNSUPPORTED_FORMAT" else 422)


@app.exception_handler(AgentError)
async def agent_exc(_: Request, exc: AgentError):
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)


# ---------------------------------------------------------------- helpers
def _with_urls(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            out[k] = _with_urls(v)
            if k.endswith("_key") and isinstance(v, str) and v:
                out[k[:-4] + "_url"] = storage.url(v)
            if k == "layer_keys" and isinstance(v, dict):
                out["layer_urls"] = {n: storage.url(x) for n, x in v.items()}
        return out
    if isinstance(obj, list):
        return [_with_urls(v) for v in obj]
    return obj


def _session_out(s: dict) -> dict:
    return _with_urls(s) | {"runtime": {"environment": environment()}}


def _load(iid: str) -> dict:
    s = repo.load(iid)
    if s is None:
        _err(404, "NOT_FOUND", f"Inspection {iid} not found.")
    return s


def _scenarios() -> dict:
    p = FIXTURES_DIR / "scenarios.json"
    if not p.exists():
        return {"scenarios": [], "fixtures": {}}
    return json.loads(p.read_text(encoding="utf-8"))


def _fixture(fid: str) -> tuple[dict, bytes]:
    data = _scenarios()
    meta = data.get("fixtures", {}).get(fid)
    if meta is None:
        _err(404, "UNKNOWN_FIXTURE", f"Fixture {fid} does not exist.")
    path = (FIXTURES_DIR / meta["file"]).resolve()
    if FIXTURES_DIR.resolve() not in path.parents or not path.exists():
        _err(404, "UNKNOWN_FIXTURE", f"Fixture {fid} file missing.")
    return meta, path.read_bytes()


async def _read_upload(f: UploadFile) -> bytes:
    data = await f.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError("FILE_TOO_LARGE", f"Image exceeds the {MAX_UPLOAD_BYTES / 1e6:.0f} MB limit.")
    return data


# ---------------------------------------------------------------- system
@app.get("/api/health")
def health():
    return {"status": "ok", "opencv_version": __import__("cv2").__version__, "environment": environment(),
            "storage": storage.backend}


@app.get("/api/runtime")
def runtime():
    return runtime_info(storage.describe())


@app.get("/api/agent/tools")
def agent_tools():
    return {"tools": TOOL_CONTRACTS}


@app.get("/api/agent/policies")
def agent_policies():
    return {"rules": RULES, "max_recaptures": MAX_RECAPTURES, "recommended_checks": RECOMMENDED_CHECKS,
            "quality_thresholds": quality.THRESHOLDS, "candidate_params": cand_mod.PARAMS,
            "registration_criteria": registration.CRITERIA, "change_params": differences.PARAMS}


@app.get("/api/scenarios")
def scenarios():
    data = _scenarios()
    fx = data.get("fixtures", {})
    return {
        "scenarios": data.get("scenarios", []),
        "fixtures": {k: {kk: vv for kk, vv in v.items() if kk != "file"} | {"url": f"/api/fixtures/{k}"} for k, v in fx.items()},
    }


@app.get("/api/fixtures/{fid}")
def fixture_image(fid: str):
    meta, data = _fixture(fid)
    mime = "image/png" if meta["file"].lower().endswith(".png") else "image/jpeg"
    return Response(data, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/artifacts/{key:path}")
def artifact(key: str):
    if storage.backend != "local-filesystem":
        return RedirectResponse(storage.url(key))
    if not (key.startswith("artifacts/") or key.startswith("captures/")):
        _err(404, "NOT_FOUND", "No such artifact.")
    try:
        data = storage.get(key)
    except ValueError:
        data = None
    if data is None:
        _err(404, "NOT_FOUND", "No such artifact.")
    mime = "image/png" if key.endswith(".png") else ("image/jpeg" if key.endswith(".jpg") else "application/octet-stream")
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=3600"})


# ---------------------------------------------------------------- inspections
class CreateInspection(BaseModel):
    mode: str = Field("inspection", pattern="^(inspection|verification)$")
    scenario_id: str | None = Field(None, max_length=64)
    board_region: str | None = Field(None, max_length=32)
    board_region_label: str | None = Field(None, max_length=80)


@app.post("/api/inspections")
def create_inspection(body: CreateInspection):
    return _session_out(agent.create_session(body.mode, body.scenario_id, body.board_region, body.board_region_label))


@app.get("/api/inspections/{iid}")
def get_inspection(iid: str):
    return _session_out(_load(iid))


@app.post("/api/inspections/{iid}/captures")
async def submit_capture(iid: str, file: UploadFile | None = File(None), fixture_id: str | None = Form(None),
                         source_kind: str | None = Form(None), label: str | None = Form(None)):
    s = _load(iid)
    if fixture_id:
        meta, data = _fixture(fixture_id)
        source = {"kind": "fixture", "fixture_id": fixture_id, "label": meta.get("label"), "provenance": meta.get("provenance"),
                  "license": meta.get("license"), "attribution": meta.get("attribution"), "synthetic": meta.get("synthetic", False)}
    elif file is not None:
        data = await _read_upload(file)
        kind = source_kind if source_kind in ("upload", "camera") else "upload"
        source = {"kind": kind, "label": (label or file.filename or "uploaded image")[:120],
                  "provenance": "Live camera capture" if kind == "camera" else "User-uploaded image", "synthetic": False}
    else:
        _err(422, "NO_IMAGE", "Provide an image file or a fixture_id.")
    t0 = time.perf_counter()
    s = agent.submit_observation(s, data, source)
    s["observations"][-1]["api_processing_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    repo.save(s)
    return _session_out(s)


class Action(BaseModel):
    type: str = Field(..., max_length=40)
    candidate_id: str | None = Field(None, max_length=16)
    decision: str | None = Field(None, max_length=16)
    note: str | None = Field(None, max_length=500)
    result: str | None = Field(None, max_length=300)


@app.post("/api/inspections/{iid}/actions")
def inspection_action(iid: str, body: Action):
    s = _load(iid)
    return _session_out(agent.technician_action(s, body.model_dump()))


@app.get("/api/inspections/{iid}/trace")
def trace(iid: str):
    s = _load(iid)
    return Response(report.dumps({"inspection_id": iid, "state": s["state"], "events": s["trace"]}), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{iid}-trace.json"'})


@app.get("/api/inspections/{iid}/report.json")
def report_json(iid: str):
    s = _load(iid)
    return Response(report.dumps(report.build_json(s, runtime_info(storage.describe()))), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{iid}-report.json"'})


@app.get("/api/inspections/{iid}/report.html", response_class=HTMLResponse)
def report_html(iid: str):
    s = _load(iid)
    return HTMLResponse(report.build_html(s, storage, runtime_info(storage.describe())))


# ---------------------------------------------------------------- stateless tools
@app.post("/api/vision/quality")
async def vision_quality(file: UploadFile = File(...)):
    img = decode_image(await _read_upload(file))
    t0 = time.perf_counter()
    q = quality.public(quality.assess_image_quality(img.image))
    return {"quality": q, "working_size": [img.width, img.height], "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
            "environment": environment()}


@app.post("/api/vision/candidates")
async def vision_candidates(file: UploadFile = File(...)):
    img = decode_image(await _read_upload(file))
    t0 = time.perf_counter()
    det = cand_mod.detect_visual_candidates(img.image)
    return {"candidates": det["candidates"], "lead_rows": det["lead_rows"], "working_size": [img.width, img.height],
            "duration_ms": round((time.perf_counter() - t0) * 1000, 1), "environment": environment()}


@app.post("/api/vision/register")
async def vision_register(reference: UploadFile = File(...), moving: UploadFile = File(...)):
    ref = decode_image(await _read_upload(reference))
    mov = decode_image(await _read_upload(moving))
    t0 = time.perf_counter()
    reg = registration.register_image_pair(ref.image, mov.image)
    change = None
    if reg["status"] != "FAILED":
        warped, valid = registration.warp_to_reference(mov.image, reg["_H"], ref.image.shape)
        ch = differences.compute_change_map(ref.image, warped, valid)
        change = {k: v for k, v in ch.items() if not k.startswith("_")}
    reg = {k: v for k, v in reg.items() if not k.startswith("_")}
    return {"registration": reg, "change": change, "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
            "environment": environment()}


# ---------------------------------------------------------------- bundled workstation UI (single-origin deployment)
_static = os.environ.get("BOARDGUARD_STATIC_DIR")
if _static and Path(_static).is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_static, html=True), name="ui")