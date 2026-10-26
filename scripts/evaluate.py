"""BoardGuard reproducible evaluation suite.

Run from the repository root with the vision-api environment:

    services/vision-api/.venv/Scripts/python scripts/evaluate.py      (Windows)
    services/vision-api/.venv/bin/python scripts/evaluate.py          (Linux/macOS)

Writes apps/web/public/evaluation/results.json (shown on the System screen)
and docs/evaluation/results.md. Every number is computed by this script on
this machine; nothing is hand-entered. Ground truth is either exact by
construction (synthetic renderings, known homographies, known degradations)
or explicitly marked as unavailable.
"""

from __future__ import annotations

import json
import os
import platform
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "services" / "vision-api"
sys.path.insert(0, str(API))
os.environ.setdefault("BOARDGUARD_DATA_DIR", tempfile.mkdtemp(prefix="bg-eval-"))
os.environ.setdefault("BOARDGUARD_FIXTURES_DIR", str(ROOT / "datasets" / "fixtures"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.vision import candidates as cand_mod  # noqa: E402
from app.vision import differences, quality, registration  # noqa: E402
from app.vision.imageio import decode_image  # noqa: E402
from tests.synth import add_glare, jpeg, render_board, warp  # noqa: E402

RNG = np.random.default_rng(2026)
RAW = ROOT / "datasets" / "raw"
OUT_JSON = ROOT / "apps" / "web" / "public" / "evaluation" / "results.json"
OUT_MD = ROOT / "docs" / "evaluation" / "results.md"


def load_real() -> list[dict]:
    man = RAW / "manifest.json"
    if not man.exists():
        return []
    items = json.loads(man.read_text(encoding="utf-8"))
    out = []
    for it in items:
        p = RAW / it["file"]
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png") or not p.exists():
            continue
        img = decode_image(p.read_bytes()).image
        out.append({**it, "img": img})
    return out


def pct(x: float) -> float:
    return round(100.0 * x, 1)


def timed(fn, *a, **kw):
    t0 = time.perf_counter()
    r = fn(*a, **kw)
    return r, (time.perf_counter() - t0) * 1000


# ----------------------------------------------------------------- 1. quality gate
def eval_quality(real: list[dict]) -> dict:
    rows = []
    det = {"blur_s1.5": [], "blur_s3": [], "blur_s5": [], "glare": [], "dark": [], "bright": []}
    orig_verdicts = []
    failures = []
    for it in real:
        img = it["img"]
        q0 = quality.assess_image_quality(img)
        orig_verdicts.append(q0["verdict"])
        if q0["verdict"] == "REJECT":
            failures.append(f"Original {it['file']} rejected ({', '.join(r['code'] for r in q0['reasons'])}); no ground truth that it is usable - review manually.")
        h, w = img.shape[:2]
        tests = {
            "blur_s1.5": (cv2.GaussianBlur(img, (0, 0), 1.5), "BLUR"),
            "blur_s3": (cv2.GaussianBlur(img, (0, 0), 3.0), "BLUR"),
            "blur_s5": (cv2.GaussianBlur(img, (0, 0), 5.0), "BLUR"),
            "glare": (add_glare(img, (int(RNG.integers(w // 4, 3 * w // 4)), int(RNG.integers(h // 4, 3 * h // 4))), int(0.11 * min(h, w))), "GLARE"),
            "dark": ((img.astype(np.float32) * 0.13).astype(np.uint8), "UNDEREXPOSED"),
            "bright": (np.clip(img.astype(np.float32) * 1.9 + 70, 0, 255).astype(np.uint8), "OVEREXPOSED"),
        }
        row = [it["file"], q0["verdict"], round(q0["metrics"]["blur_metric"], 3)]
        for k, (deg, code) in tests.items():
            q = quality.assess_image_quality(deg)
            hit = any(r["code"] == code for r in q["reasons"])
            det[k].append(hit)
            if not hit and k != "blur_s1.5":
                failures.append(f"{k} degradation of {it['file']} not flagged as {code} (verdict {q['verdict']}, blur {q['metrics']['blur_metric']:.2f}, glare {q['metrics']['glare_fraction']:.3f}).")
        row.append(round(quality.assess_image_quality(tests["blur_s3"][0])["metrics"]["blur_metric"], 3))
        rows.append(row)
    n = len(real)
    metrics = [{"name": "real source images", "value": n}]
    if n:
        metrics += [{"name": f"flagged: {k}", "value": pct(sum(v) / n), "unit": "%"} for k, v in det.items()]
        metrics.append({"name": "originals ACCEPT/MARGINAL/REJECT", "value": f"{orig_verdicts.count('ACCEPT')}/{orig_verdicts.count('MARGINAL')}/{orig_verdicts.count('REJECT')}"})
    return {
        "id": "quality",
        "title": "Quality gate on controlled degradations of real photographs",
        "method": "Each licensed real PCB photograph is degraded in a known way (Gaussian blur sigma 1.5/3/5 px, synthetic specular highlight, x0.13 exposure, x1.9+70 gain). A degradation counts as detected when the matching reason code is raised. Originals have no quality ground truth; their verdicts are reported, not scored.",
        "data": f"{n} images from datasets/raw (Wikimedia Commons, see licences).",
        "metrics": metrics,
        "table": {"columns": ["image", "original verdict", "blur metric", "blur metric @ sigma 3"], "rows": rows},
        "failures": failures[:12],
    }


# ----------------------------------------------------------------- 2. candidates (synthetic GT)
def synth_case(kind: str, seed: int):
    r = np.random.default_rng(seed)
    kw = {"seed": seed}
    if "bridge" in kind:
        kw.update(bridge=True, bridge_index=int(r.integers(1, 14)), bridge_row=str(r.choice(["top", "bottom"])))
    if "corrosion" in kind:
        kw.update(corrosion=True, corrosion_center=(int(r.integers(110, 260)), int(r.integers(150, 650))),
                  corrosion_radius=int(r.integers(45, 85)),
                  corrosion_bgr=tuple(int(v) for v in (r.integers(150, 200), r.integers(150, 190), r.integers(70, 120))))
    img, gt = render_board(**kw)
    moved, H = warp(img, seed=seed + 1000, max_shift=25, max_rot_deg=4)
    gain = float(r.uniform(0.85, 1.15))
    moved = np.clip(moved.astype(np.float32) * gain, 0, 255).astype(np.uint8)
    boxes = {"suspected_solder_bridge": [registration.map_rect(H, b) for b in gt["bridges"]],
             "suspected_corrosion": [registration.map_rect(H, b) for b in gt["corrosion"]]}
    return moved, boxes


def eval_candidates(real: list[dict]) -> dict:
    kinds = ["clean", "bridge", "corrosion", "bridge+corrosion"]
    tp = {"suspected_solder_bridge": 0, "suspected_corrosion": 0}
    fp = dict(tp)
    fn = dict(tp)
    times = []
    per_kind = []
    failures = []
    seed = 100
    for kind in kinds:
        k_tp = k_fp = k_fn = 0
        for _ in range(12):
            seed += 1
            img, gt = synth_case(kind, seed)
            det, ms = timed(cand_mod.detect_visual_candidates, img)
            times.append(ms)
            for t in tp:
                preds = [c["bbox"] for c in det["candidates"] if c["type"] == t]
                gts = gt[t]
                matched = set()
                for p in preds:
                    j = next((i for i, g in enumerate(gts) if i not in matched and cand_mod.iou(p, g) >= 0.2), None)
                    if j is None:
                        fp[t] += 1
                        k_fp += 1
                    else:
                        matched.add(j)
                        tp[t] += 1
                        k_tp += 1
                miss = len(gts) - len(matched)
                fn[t] += miss
                k_fn += miss
                if miss:
                    failures.append(f"seed {seed} ({kind}): missed {t}")
        per_kind.append([kind, 12, k_tp, k_fp, k_fn])
    metrics = []
    for t, label in (("suspected_solder_bridge", "bridge"), ("suspected_corrosion", "corrosion")):
        p = tp[t] / max(1, tp[t] + fp[t])
        r = tp[t] / max(1, tp[t] + fn[t])
        metrics += [{"name": f"{label} precision", "value": round(p, 3)}, {"name": f"{label} recall", "value": round(r, 3)}]
    metrics.append({"name": "median detection time", "value": round(statistics.median(times), 1), "unit": "ms"})

    # Indicative behaviour on real photographs (no localisation ground truth exists).
    real_rows = []
    for it in real:
        det = cand_mod.detect_visual_candidates(it["img"])
        types = [c["type"] for c in det["candidates"]]
        real_rows.append([it["file"], it["category"], types.count("suspected_corrosion"), types.count("suspected_solder_bridge"),
                          sum(1 for c in det["candidates"] if not c["evidence_quality"]["sufficient"])])
    by_cat: dict[str, list] = {}
    for r_ in real_rows:
        by_cat.setdefault(r_[1], []).append(r_)
    for cat, rs in sorted(by_cat.items()):
        metrics.append({"name": f"real '{cat}': images with corrosion cand.", "value": f"{sum(1 for r_ in rs if r_[2])}/{len(rs)}",
                        "note": "Category labels come from visual review of public photos, not expert annotation."})
    return {
        "id": "candidates",
        "title": "Candidate localisation",
        "method": "Synthetic boards with exact ground truth (randomised bridge position/row, corrosion position/size/colour), each warped by a random homography with a gain change; a detection matches at IoU >= 0.2. Real photographs have no localisation ground truth, so only per-category candidate counts are reported.",
        "data": f"48 synthetic renderings (12 per class mix); {len(real)} real photographs (indicative only).",
        "metrics": metrics,
        "table": {"columns": ["real image", "category", "corrosion cand.", "bridge cand.", "insufficient evidence"], "rows": real_rows},
        "failures": failures[:10] + ["Real-image counts are not accuracy: corrosion-like colour/texture on clean boards (e.g. pale silkscreen, flux residue, teal solder mask) can raise candidates, and real bridges under different geometry can be missed."],
    }


# ----------------------------------------------------------------- 3. registration
def eval_registration(real: list[dict]) -> dict:
    ok = 0
    errs = []
    times = []
    rows = []
    failures = []
    total = 0
    for i, it in enumerate(real):
        for k in range(3):
            total += 1
            img = it["img"]
            moved, Hgt = warp(img, seed=i * 10 + k, max_shift=0.04 * img.shape[1], max_rot_deg=8, scale_jitter=0.08)
            moved = np.clip(moved.astype(np.float32) * RNG.uniform(0.8, 1.2) + RNG.uniform(-15, 15), 0, 255).astype(np.uint8)
            r, ms = timed(registration.register_image_pair, img, moved)
            times.append(ms)
            if r["status"] != "FAILED":
                ok += 1
                h, w = img.shape[:2]
                c = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
                e = float(np.linalg.norm(cv2.perspectiveTransform(c, r["_H"]) - cv2.perspectiveTransform(c, np.linalg.inv(Hgt)), axis=2).max())
                errs.append(e)
                rows.append([it["file"], k, r["status"], r["inliers"], round(r["inlier_ratio"], 3), round(r["rms_reprojection_px"], 2), round(e, 2)])
                if e > 5:
                    failures.append(f"{it['file']} warp {k}: accepted with {e:.1f}px corner error.")
            else:
                rows.append([it["file"], k, "FAILED", r.get("inliers", 0), r.get("inlier_ratio", 0), "-", "-"])
                failures.append(f"{it['file']} warp {k}: registration failed ({'; '.join(r['reasons'])[:120]}).")
    # Negative pairs: different photographs must not register.
    neg = 0
    neg_ok = 0
    for i in range(len(real)):
        j = (i + 1) % len(real)
        if i == j:
            continue
        neg += 1
        r = registration.register_image_pair(real[i]["img"], real[j]["img"])
        if r["status"] == "FAILED":
            neg_ok += 1
        else:
            failures.append(f"Unrelated pair {real[i]['file']} / {real[j]['file']} accepted as {r['status']} ({r['inliers']} inliers).")
    metrics = [
        {"name": "known-warp pairs", "value": total},
        {"name": "registered (REGISTERED/WEAK)", "value": pct(ok / max(1, total)), "unit": "%"},
        {"name": "median max-corner error", "value": round(statistics.median(errs), 2) if errs else "-", "unit": "px"},
        {"name": "worst max-corner error", "value": round(max(errs), 2) if errs else "-", "unit": "px"},
        {"name": "unrelated pairs correctly FAILED", "value": f"{neg_ok}/{neg}"},
        {"name": "median registration time", "value": round(statistics.median(times), 1) if times else "-", "unit": "ms"},
    ]
    return {
        "id": "registration",
        "title": "Image registration (SIFT/ORB + MAGSAC homography)",
        "method": "Each real photograph is warped by a random plausible homography (rotation <= 8 deg, scale +/- 8 %, shift <= 4 % width, mild perspective) plus gain/offset change; error = max distance between estimated and true image-corner positions. Negative pairs are consecutive unrelated photographs.",
        "data": f"{len(real)} real photographs x 3 warps; {neg} unrelated pairs.",
        "metrics": metrics,
        "table": {"columns": ["image", "warp", "status", "inliers", "inlier ratio", "RMS px", "corner err px"], "rows": rows},
        "failures": failures[:12],
    }


# ----------------------------------------------------------------- 4. change detection
def eval_change() -> dict:
    hits = 0
    total = 0
    spurious = 0
    spurious_px = []
    times = []
    for s in range(15):
        before, gt = render_board(seed=500 + s, bridge=True, bridge_index=int(RNG.integers(1, 14)), corrosion=bool(s % 2),
                                  corrosion_center=(int(RNG.integers(110, 260)), int(RNG.integers(150, 650))))
        after, _ = render_board(seed=500 + s)
        moved, _ = warp(after, seed=900 + s, max_shift=15, max_rot_deg=3)
        r = registration.register_image_pair(before, moved)
        if r["status"] == "FAILED":
            continue
        warped, valid = registration.warp_to_reference(moved, r["_H"], before.shape)
        ch, ms = timed(differences.compute_change_map, before, warped, valid)
        times.append(ms)
        for b in gt["bridges"] + gt["corrosion"]:
            total += 1
            if differences.candidate_change_overlap(ch["_mask"], b) > 0.03:
                hits += 1
        # Identical content: any region is spurious.
        same, _ = warp(before, seed=1900 + s, max_shift=12, max_rot_deg=2)
        r2 = registration.register_image_pair(before, same)
        w2, v2 = registration.warp_to_reference(same, r2["_H"], before.shape)
        ch2 = differences.compute_change_map(before, w2, v2)
        spurious += len(ch2["regions"])
        spurious_px.append(ch2["changed_fraction"])
    return {
        "id": "change",
        "title": "Change detection after registration",
        "method": "Synthetic before/after pairs where a solder bridge (and, in half the pairs, a corrosion deposit) is removed and the after view is re-framed by a random homography. A removed defect counts as found when >3 % of its box is marked changed. Control: the same image re-framed with no content change.",
        "data": "15 synthetic pairs (+15 no-change controls).",
        "metrics": [
            {"name": "removed defects marked changed", "value": f"{hits}/{total}"},
            {"name": "spurious regions on no-change controls", "value": spurious},
            {"name": "mean changed fraction on controls", "value": pct(float(np.mean(spurious_px))) if spurious_px else "-", "unit": "%"},
            {"name": "median change-map time", "value": round(statistics.median(times), 1) if times else "-", "unit": "ms"},
        ],
        "failures": ["Not evaluated on real before/after repair pairs: no licensed matched pair of a physically repaired board was available."],
    }


# ----------------------------------------------------------------- 5. agent behaviour
def eval_agent() -> dict:
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)

    def new(mode="inspection"):
        return client.post("/api/inspections", json={"mode": mode}).json()["inspection_id"]

    def sub(iid, img):
        return client.post(f"/api/inspections/{iid}/captures", files={"file": ("x.jpg", jpeg(img), "image/jpeg")}).json()

    def rules(s):
        return [e["trigger"]["rule"] for e in s["trace"] if e.get("trigger")]

    rows = []
    unsafe = 0
    glare = {"glare_at": (575, 545), "glare_radius": 45}

    def case(name, expected, fn):
        nonlocal unsafe
        s = fn()
        got = s["state"] + " / " + (rules(s)[-1] if rules(s) else "-")
        ok = expected(s)
        if s["state"] == "COMPLETED" and not any(e["kind"] == "human" for e in s["trace"]):
            unsafe += 1
        rows.append([name, "pass" if ok else "FAIL", got])

    def blur_first():
        iid = new()
        return sub(iid, render_board(bridge=True, blur_sigma=4)[0])
    case("blurred capture -> recapture, no analysis", lambda s: s["pending_action"]["rule"] == "R-Q1" and not any(e["tool"] == "detect_visual_candidates" for e in s["trace"]), blur_first)

    def good_bridge():
        return sub(new(), render_board(bridge=True)[0])
    case("clear bridge -> technician review", lambda s: s["state"] == "TECHNICIAN_REVIEW_REQUIRED" and "R-E2" in rules(s), good_bridge)

    def clean_board():
        return sub(new(), render_board()[0])
    case("no findings -> acknowledgment (not clearance)", lambda s: s["pending_action"]["no_findings"] and "R-N1" in rules(s), clean_board)

    def glare_then_clean():
        iid = new()
        sub(iid, render_board(**glare)[0])
        return sub(iid, warp(render_board()[0], seed=3, max_shift=12, max_rot_deg=2)[0])
    case("glare suspicion, clean recapture -> not reproduced, review", lambda s: "R-M3" in rules(s) and s["findings"][0]["priority"] == "LOW" and s["state"] == "TECHNICIAN_REVIEW_REQUIRED", glare_then_clean)

    def glare_then_bridge():
        iid = new()
        sub(iid, render_board(bridge=True, **glare)[0])
        return sub(iid, warp(render_board(bridge=True)[0], seed=4, max_shift=12, max_rot_deg=2)[0])
    case("bridge under glare, clean recapture -> persisted, high priority", lambda s: "R-M2" in rules(s) and s["findings"][0]["priority"] == "HIGH", glare_then_bridge)

    def glare_then_unrelated():
        iid = new()
        sub(iid, render_board(**glare)[0])
        noise = cv2.GaussianBlur((np.random.default_rng(3).random((900, 1200, 3)) * 255).astype(np.uint8), (0, 0), 1.2)
        return sub(iid, noise)
    case("unregistrable recapture -> comparison withheld", lambda s: "R-M1" in rules(s) and s["observations"][-1]["comparison"]["comparable"] is False, glare_then_unrelated)

    def blur_loop():
        iid = new()
        s = None
        for _ in range(3):
            s = sub(iid, render_board(blur_sigma=5)[0])
        return s
    case("persistent blur -> stops safely after 2 recaptures", lambda s: s["state"] == "FAILED_SAFELY", blur_loop)

    def verify_ok():
        iid = new("verification")
        sub(iid, render_board(bridge=True)[0])
        return sub(iid, warp(render_board()[0], seed=5, max_shift=10, max_rot_deg=2)[0])
    case("before/after registered -> change documented, technician confirm", lambda s: "R-V3" in rules(s) and s["pending_action"]["type"] == "CONFIRM_VISUAL_CHECKS", verify_ok)

    def verify_bad():
        iid = new("verification")
        sub(iid, render_board(bridge=True)[0])
        noise = cv2.GaussianBlur((np.random.default_rng(9).random((900, 1200, 3)) * 255).astype(np.uint8), (0, 0), 1.2)
        return sub(iid, noise)
    case("before/after unregistrable -> overlay withheld", lambda s: "R-V2" in rules(s) and s["verification"]["change"] is None, verify_bad)

    # Single image vs. reinspection on glare-ambiguous cases.
    single_wrong = 0
    reinspect_right = 0
    n = 0
    for s in range(10):
        has_bridge = s % 2 == 0
        idx = int(np.random.default_rng(s).integers(3, 12))
        lx = 330 + 20 + idx * 30
        ga = {"glare_at": (lx + 20, 545), "glare_radius": 45}
        iid = new()
        s1 = sub(iid, render_board(bridge=has_bridge, bridge_index=idx, **ga)[0])
        n += 1
        # Single-image policy without the evidence check would report every detected bridge as a bridge.
        single_says_bridge = any(c["type"] == "suspected_solder_bridge" for c in s1["observations"][-1]["candidates"])
        if single_says_bridge != has_bridge:
            single_wrong += 1
        if s1["state"] != "RECAPTURE_REQUESTED":
            continue
        s2 = sub(iid, warp(render_board(bridge=has_bridge, bridge_index=idx)[0], seed=40 + s, max_shift=10, max_rot_deg=2)[0])
        persisted = any(f["priority"] == "HIGH" for f in s2["findings"])
        if persisted == has_bridge:
            reinspect_right += 1
    passed = sum(1 for r in rows if r[1] == "pass")
    return {
        "id": "agent",
        "title": "Agent behaviour and reinspection benefit",
        "method": "Scripted scenarios through the real HTTP API and state machine; each has an expected next action/rule. Unsafe conclusion = a session COMPLETED without any technician action. Reinspection benefit: 10 glare-ambiguous cases (half with a real bridge) compare a naive single-image reading with the outcome after one targeted recapture.",
        "data": "Synthetic captures with known content (labelled synthetic).",
        "metrics": [
            {"name": "scenarios with expected action", "value": f"{passed}/{len(rows)}"},
            {"name": "unsafe automatic conclusions", "value": unsafe},
            {"name": "single image: wrong bridge reading", "value": f"{single_wrong}/{n}"},
            {"name": "after reinspection: correct persisted/not-reproduced", "value": f"{reinspect_right}/{n}"},
        ],
        "table": {"columns": ["scenario", "result", "final state / last rule"], "rows": rows},
        "failures": [r[0] + " -> " + r[2] for r in rows if r[1] != "pass"] + ["Reinspection benefit is measured on synthetic glare, not on real microscope recaptures."],
    }


# ----------------------------------------------------------------- 6. performance
def eval_perf(real: list[dict]) -> dict:
    imgs = [it["img"] for it in real] or [render_board()[0]]
    tq, tc = [], []
    for img in imgs:
        tq.append(timed(quality.assess_image_quality, img)[1])
        tc.append(timed(cand_mod.detect_visual_candidates, img)[1])
    sizes = [f"{i.shape[1]}x{i.shape[0]}" for i in imgs]
    return {
        "id": "performance",
        "title": "Local processing latency",
        "method": "Wall-clock time of each pipeline on the working-resolution images (longest side <= 1600 px), single process.",
        "data": f"{len(imgs)} images; host: {platform.processor() or platform.machine()} / {os.cpu_count()} logical CPUs; OpenCV threads {cv2.getNumThreads()}.",
        "metrics": [
            {"name": "quality median", "value": round(statistics.median(tq), 1), "unit": "ms"},
            {"name": "quality p95", "value": round(float(np.percentile(tq, 95)), 1), "unit": "ms"},
            {"name": "candidates median", "value": round(statistics.median(tc), 1), "unit": "ms"},
            {"name": "candidates p95", "value": round(float(np.percentile(tc, 95)), 1), "unit": "ms"},
            {"name": "typical working size", "value": max(set(sizes), key=sizes.count)},
        ],
    }


def main():
    t0 = time.perf_counter()
    real = load_real()
    print(f"OpenCV {cv2.__version__}; {len(real)} real images")
    sections = []
    for fn in (lambda: eval_quality(real), lambda: eval_candidates(real), lambda: eval_registration(real), eval_change, eval_agent, lambda: eval_perf(real)):
        s = fn()
        print(f"  {s['title']}: " + "; ".join(f"{m['name']}={m['value']}" for m in s["metrics"][:6]))
        sections.append(s)
    res = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "opencv_version": cv2.__version__,
        "environment": f"local · {platform.system()} {platform.release()} · Python {platform.python_version()}",
        "command": "services/vision-api/.venv/Scripts/python scripts/evaluate.py",
        "duration_s": round(time.perf_counter() - t0, 1),
        "sections": sections,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    if (RAW / "manifest.json").exists():
        man = json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))
        (OUT_JSON.parent / "datasets.json").write_text(json.dumps(man, indent=1), encoding="utf-8")
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    md = [f"# BoardGuard evaluation results\n", f"Generated {res['generated_at']} with OpenCV {res['opencv_version']} ({res['environment']}) in {res['duration_s']} s.\n",
          f"Reproduce: `{res['command']}`\n"]
    for s in sections:
        md.append(f"\n## {s['title']}\n\n**Method.** {s['method']}\n\n**Data.** {s['data']}\n\n| Metric | Value |\n|---|---|")
        for m in s["metrics"]:
            md.append(f"| {m['name']} | {m['value']}{(' ' + m['unit']) if m.get('unit') else ''} |")
        if s.get("table"):
            md.append("\n| " + " | ".join(s["table"]["columns"]) + " |\n|" + "---|" * len(s["table"]["columns"]))
            for r in s["table"]["rows"]:
                md.append("| " + " | ".join(str(v) for v in r) + " |")
        if s.get("failures"):
            md.append("\n**Failure cases / limitations**\n")
            md += [f"- {f}" for f in s["failures"]]
    OUT_MD.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)} in {res['duration_s']} s")


if __name__ == "__main__":
    main()
