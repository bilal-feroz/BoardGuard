import cv2
import numpy as np
import pytest

from app.vision import candidates, differences, quality, registration
from app.vision.imageio import ImageError, decode_image
from tests.synth import add_glare, jpeg, render_board, warp


def _iou(a, b):
    return candidates.iou(a, b)


def test_opencv_is_version_5():
    assert cv2.__version__.startswith("5."), cv2.__version__


# ---------------------------------------------------------------- image IO
def test_decode_rejects_garbage_and_truncation():
    with pytest.raises(ImageError) as e:
        decode_image(b"not an image at all")
    assert e.value.code == "UNSUPPORTED_FORMAT"
    img, _ = render_board()
    data = jpeg(img)
    with pytest.raises(ImageError) as e:
        decode_image(data[:200])
    assert e.value.code == "CORRUPT_IMAGE"
    with pytest.raises(ImageError) as e:
        decode_image(b"")
    assert e.value.code == "EMPTY_FILE"


def test_decode_downscales_to_working_resolution():
    big = np.zeros((2400, 3200, 3), np.uint8)
    d = decode_image(cv2.imencode(".png", big)[1].tobytes())
    assert max(d.width, d.height) == 1600 and d.original_width == 3200


# ---------------------------------------------------------------- quality
def test_quality_accepts_clean_and_rejects_blur():
    clean, _ = render_board()
    assert quality.assess_image_quality(clean)["verdict"] == "ACCEPT"
    blurred, _ = render_board(blur_sigma=4)
    q = quality.assess_image_quality(blurred)
    assert q["verdict"] == "REJECT"
    assert any(r["code"] == "BLUR" for r in q["reasons"])


def test_quality_blur_metric_is_monotonic():
    img, _ = render_board()
    vals = [quality.assess_image_quality(cv2.GaussianBlur(img, (0, 0), s) if s else img)["metrics"]["blur_metric"]
            for s in (0, 1, 2, 3, 5)]
    assert all(a < b for a, b in zip(vals, vals[1:])), vals


def test_quality_flags_exposure():
    img, _ = render_board()
    dark = (img * 0.12).astype(np.uint8)
    assert any(r["code"] == "UNDEREXPOSED" for r in quality.assess_image_quality(dark)["reasons"])
    bright = np.clip(img.astype(np.int16) + 215, 0, 255).astype(np.uint8)
    assert any(r["code"] == "OVEREXPOSED" for r in quality.assess_image_quality(bright)["reasons"])


def test_region_glare_makes_evidence_insufficient():
    img, _ = render_board()
    g = add_glare(img, (575, 545), 45)
    roi = (540, 510, 70, 70)
    assert quality.assess_region(img, roi)["sufficient"]
    r = quality.assess_region(g, roi)
    assert not r["sufficient"] and r["issues"][0]["code"] == "GLARE"


# ---------------------------------------------------------------- candidates
def test_no_candidates_on_clean_board():
    img, _ = render_board()
    assert candidates.detect_visual_candidates(img)["candidates"] == []


def test_bridge_localised():
    img, gt = render_board(bridge=True)
    det = candidates.detect_visual_candidates(img)
    bridges = [c for c in det["candidates"] if c["type"] == "suspected_solder_bridge"]
    assert len(bridges) == 1
    assert _iou(bridges[0]["bbox"], gt["bridges"][0]) > 0.3
    assert bridges[0]["features"]["mechanism"] == "merged_leads"
    assert det["lead_rows"] and abs(det["lead_rows"][0]["pitch_px"] - gt["lead_pitch"]) < 1.5


def test_corrosion_localised():
    img, gt = render_board(corrosion=True)
    det = candidates.detect_visual_candidates(img)
    corr = [c for c in det["candidates"] if c["type"] == "suspected_corrosion"]
    assert len(corr) == 1
    assert _iou(corr[0]["bbox"], gt["corrosion"][0]) > 0.5


def test_glare_candidate_has_insufficient_evidence():
    img, _ = render_board(glare_at=(575, 545), glare_radius=45)
    det = candidates.detect_visual_candidates(img)
    assert det["candidates"], "glare on adjacent leads should raise a suspicion"
    assert all(not c["evidence_quality"]["sufficient"] for c in det["candidates"])


# ---------------------------------------------------------------- registration + change
def test_registration_recovers_known_homography():
    img, _ = render_board(bridge=True)
    for seed in (1, 2, 3):
        moved, Hgt = warp(img, seed=seed)
        r = registration.register_image_pair(img, moved)
        assert r["status"] == "REGISTERED", r["reasons"]
        corners = np.float32([[0, 0], [1200, 0], [1200, 900], [0, 900]]).reshape(-1, 1, 2)
        err = np.linalg.norm(cv2.perspectiveTransform(corners, r["_H"]) - cv2.perspectiveTransform(corners, np.linalg.inv(Hgt)), axis=2)
        assert err.max() < 2.0


def test_registration_fails_on_unrelated_content():
    img, _ = render_board()
    rng = np.random.default_rng(5)
    noise = (rng.random((900, 1200, 3)) * 255).astype(np.uint8)
    noise = cv2.GaussianBlur(noise, (0, 0), 3)
    r = registration.register_image_pair(img, noise)
    assert r["status"] == "FAILED"
    assert r["homography"] is None


def test_change_map_localises_repair_and_ignores_misalignment():
    before, gt = render_board(bridge=True)
    after, _ = render_board()
    moved, _ = warp(after, seed=4, max_shift=12, max_rot_deg=2)
    r = registration.register_image_pair(before, moved)
    assert r["status"] == "REGISTERED"
    warped, valid = registration.warp_to_reference(moved, r["_H"], before.shape)
    ch = differences.compute_change_map(before, warped, valid)
    assert ch["regions"], "removing the bridge must produce a change region"
    assert _iou(ch["regions"][0]["bbox"], gt["bridges"][0]) > 0.2
    assert ch["changed_fraction"] < 0.02  # nothing else changed


def test_change_map_identical_images_has_no_regions():
    img, _ = render_board()
    moved, _ = warp(img, seed=6, max_shift=10, max_rot_deg=1.5)
    r = registration.register_image_pair(img, moved)
    warped, valid = registration.warp_to_reference(moved, r["_H"], img.shape)
    ch = differences.compute_change_map(img, warped, valid)
    assert ch["regions"] == []
