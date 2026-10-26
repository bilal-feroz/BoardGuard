"""Build the judge demo fixtures and scenarios from licensed source images.

    services/vision-api/.venv/Scripts/python scripts/make_fixtures.py

Inputs:  datasets/raw/manifest.json + images (Wikimedia Commons, see manifest).
Outputs: datasets/fixtures/images/*.jpg and datasets/fixtures/scenarios.json.

Recorded images are copied (resized to the API working resolution). Synthetic
fixtures are derived from a real photograph by a documented OpenCV operation
and are flagged `synthetic: true` everywhere they appear in the product.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "vision-api"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.vision import candidates as cand_mod  # noqa: E402
from app.vision.imageio import decode_image  # noqa: E402
from tests.synth import add_glare  # noqa: E402

RAW = ROOT / "datasets" / "raw"
FIX = ROOT / "datasets" / "fixtures"
IMG = FIX / "images"
MANIFEST = {m["file"]: m for m in json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))}


def load(rel: str) -> np.ndarray:
    return decode_image((RAW / rel).read_bytes()).image


def attribution(rel: str) -> dict:
    m = MANIFEST[rel]
    return {
        "license": m["license"],
        "attribution": f"{m['author']} / Wikimedia Commons / {m['license']}",
        "source_url": m["source_page_url"],
        "source_file": rel,
    }


fixtures: dict[str, dict] = {}


def save(fid: str, img: np.ndarray, label: str, provenance: str, rel: str, synthetic: bool = False, **extra):
    IMG.mkdir(parents=True, exist_ok=True)
    name = f"{fid}.jpg"
    cv2.imwrite(str(IMG / name), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    fixtures[fid] = {"file": f"images/{name}", "label": label, "provenance": provenance, "synthetic": synthetic,
                     "width": int(img.shape[1]), "height": int(img.shape[0]), **attribution(rel), **extra}


def main():
    # S01 - suspected corrosion (real)
    rel = "corrosion/corrosion_01_nicd-leak-korg-poly61.jpg"
    save("s01_battery_leak", load(rel), "Leaked NiCd cell beside DIP IC and header",
         "Recorded photograph (real corrosion from a leaked battery).", rel)

    # S02 - possible solder bridge under glare
    rel = "fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg"
    tq = load(rel)
    save("s02_tqfp_ringlight", add_glare(tq, (1530, 700), 50), "TQFP-144 under ring light (specular glare on right lead row)",
         "SYNTHETIC: specular highlight (Gaussian, r=50 px) added with OpenCV to a real photograph to emulate ring-light glare.",
         rel, synthetic=True, derived_from="s02_tqfp_diffuse")
    save("s02_tqfp_diffuse", tq, "TQFP-144 recaptured with diffuse light",
         "Recorded photograph (real TQFP-144, 0.5 mm pitch, no glare).", rel)
    rel2 = "fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg"
    save("s02_wrong_field", load(rel2), "Different board (TQFP-64) - wrong field of view",
         "Recorded photograph of a different board; used to show that unregistrable recaptures are not compared.", rel2)

    # S03 - before/after verification
    rel = "corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg"
    before = load(rel)
    save("s03_before_corroded", before, "IC socket pins with green corrosion (before cleaning)",
         "Recorded photograph (real corrosion on IC legs and socket contacts).", rel)
    det = cand_mod.detect_visual_candidates(before)
    mask = np.zeros(before.shape[:2], np.uint8)
    for c in det["candidates"]:
        if c["type"] == "suspected_corrosion" and c["evidence_quality"]["sufficient"]:
            cv2.fillPoly(mask, [np.int32(c["polygon"])], 255)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    cleaned = cv2.inpaint(before, mask, 9, cv2.INPAINT_TELEA)
    h, w = cleaned.shape[:2]
    ang, s, tx, ty = np.deg2rad(2.5), 0.97, 28.0, -18.0
    A = np.array([[s * np.cos(ang), -s * np.sin(ang), 0], [s * np.sin(ang), s * np.cos(ang), 0], [0, 0, 1]])
    T1 = np.array([[1, 0, -w / 2], [0, 1, -h / 2], [0, 0, 1]])
    T2 = np.array([[1, 0, w / 2 + tx], [0, 1, h / 2 + ty], [0, 0, 1]])
    P = np.array([[1, 0, 0], [0, 1, 0], [0.00002, -0.00001, 1]])
    H = T2 @ P @ A @ T1
    after = cv2.warpPerspective(cleaned, H, (w, h), borderMode=cv2.BORDER_REFLECT)
    after = np.clip(after.astype(np.float32) * 1.06 + 4, 0, 255).astype(np.uint8)
    save("s03_after_cleaned_synthetic", after, "Same region after cleaning (synthetic fixture)",
         "SYNTHETIC verification fixture: the detected deposit was removed digitally with cv2.inpaint and the view re-framed "
         "by a known homography (2.5 deg, 0.97x, shift) with +6% gain. It does not depict a physical repair.",
         rel, synthetic=True, derived_from="s03_before_corroded", ground_truth_homography=H.round(6).tolist())
    rel3 = "clean/clean_08_hdd-pcb-traces-testpoints.jpg"
    save("s03_wrong_region", load(rel3), "Unrelated board area - wrong field of view",
         "Recorded photograph of a different board; registration must fail and the comparison must be withheld.", rel3)

    # S04 - unusable capture (real)
    rel = "corrosion/corrosion_04_386-motherboard-battery-leak.jpg"
    save("s04_overexposed", load(rel), "Battery-leak area photographed with flash (blown highlights)",
         "Recorded photograph (real) with strong flash glare and clipped highlights.", rel)

    # S05 - genuine rework pair (real, different framing)
    rel_b, rel_a = "pairs/pairs_01_sharp-psu-before-closeup.jpg", "pairs/pairs_02_sharp-psu-after-closeup.jpg"
    save("s05_psu_before", load(rel_b), "PSU section before capacitor replacement",
         "Recorded photograph (real) of a power-supply section before rework.", rel_b)
    save("s05_psu_after", load(rel_a), "PSU section after capacitor replacement (different angle and framing)",
         "Recorded photograph (real) of the same section after rework, shot from a different angle with re-routed wiring.", rel_a)

    scenarios = [
        {"id": "S01-corrosion", "number": "01", "title": "Suspected corrosion", "mode": "inspection", "region": "REGION-A",
         "purpose": "Real battery-leak damage. OpenCV localises blue-green deposits; the agent hands each finding to the technician.",
         "initial": "s01_battery_leak", "next_captures": []},
        {"id": "S02-bridge-glare", "number": "02", "title": "Possible solder bridge under glare", "mode": "inspection", "region": "REGION-B",
         "purpose": "Glare on a TQFP lead row looks like a bridge. The agent refuses to decide, requests diffuse light, then re-evaluates.",
         "initial": "s02_tqfp_ringlight",
         "next_captures": [
             {"fixture_id": "s02_tqfp_diffuse", "hint": "Recapture with diffuse illumination, same framing."},
             {"fixture_id": "s02_wrong_field", "hint": "Wrong field of view - shows that unregistrable captures are not compared."},
         ]},
        {"id": "S03-verification", "number": "03", "title": "Before / after verification", "mode": "verification", "region": "REGION-C",
         "purpose": "Register a before and after capture, map visible change to findings, and keep electrical verification with the technician.",
         "initial": "s03_before_corroded",
         "next_captures": [
             {"fixture_id": "s03_after_cleaned_synthetic", "hint": "After cleaning (synthetic fixture, re-framed)."},
             {"fixture_id": "s03_wrong_region", "hint": "Wrong region - registration must fail and overlays be withheld."},
         ]},
        {"id": "S04-unusable", "number": "04", "title": "Unusable capture", "mode": "inspection", "region": "REGION-E",
         "purpose": "Real flash-lit photo with clipped highlights. The quality gate rejects it before any defect analysis.",
         "initial": "s04_overexposed", "next_captures": []},
        {"id": "S05-real-rework", "number": "05", "title": "Real rework pair, different framing", "mode": "verification", "region": "REGION-D",
         "purpose": "Genuine before/after capacitor replacement shot from different angles: BoardGuard declines to overlay it.",
         "initial": "s05_psu_before",
         "next_captures": [{"fixture_id": "s05_psu_after", "hint": "Real after-rework photo (different angle and framing)."}]},
    ]
    FIX.mkdir(parents=True, exist_ok=True)
    (FIX / "scenarios.json").write_text(json.dumps({"scenarios": scenarios, "fixtures": fixtures}, indent=1), encoding="utf-8")
    total = sum((IMG / Path(f["file"]).name).stat().st_size for f in fixtures.values())
    print(f"wrote {len(fixtures)} fixtures ({total / 1e6:.1f} MB) and {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
