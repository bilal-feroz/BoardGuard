# BoardGuard — Technical Report

*AI-powered microscope assistant for electronics repair.*
OpenCV AI Competition 2026 · tracks: Grand Prize, Agentic Vision.

## 1. Problem

Independent repair technicians inspect phone and laptop logic boards under digital microscopes for
corrosion after liquid exposure, solder bridges between fine-pitch leads, damaged traces and pads, and
residue after cleaning. The evidence is often compromised — ring-light glare on solder, soft focus,
insufficient magnification — and the right response to bad evidence is another look, not a guess. Small
workshops rarely have automated optical inspection (AOI) equipment, and AOI targets factory defects on
known golden boards, not one-off repairs on unfamiliar assemblies.

## 2. Approach: active visual reinspection

BoardGuard is an inspection loop, not a one-shot detector:

1. **Measure the capture** (Pipeline A) and refuse to analyse unusable evidence.
2. **Localise suspected anomalies** (Pipeline B) and measure *local* evidence quality for each.
3. **Decide** with explicit, testable policies: decide only on adequate evidence, otherwise request a
   *specific* new observation (diffuse light, refocus, more magnification, same framing).
4. **Register the new observation** to the old one (Pipeline C) and re-evaluate every earlier finding
   (Pipeline E): *persisted*, *not reproduced*, or *still inconclusive*.
5. **Hand every finding to the technician** with a recommended electrical check. Nothing is auto-cleared.
6. **Verify after repair** (Pipeline D): register before/after captures, map visible change onto findings,
   and record that electrical verification is still pending.

## 3. Computer vision (OpenCV 5.0.0)

All processing uses `opencv-python-headless==5.0.0.93`; the version is asserted at runtime and during the
container build. Images are decoded with `cv2.imdecode` after a magic-byte format check and processed at a
bounded working resolution (longest side ≤ 1600 px).

**Pipeline A — quality.** Variance of the Laplacian and Tenengrad are reported, but the gate uses the
Crete–Roffet no-reference blur metric (re-blur comparison with `cv2.blur` 1×9 / 9×1 kernels) because
it is far less content-dependent. Exposure is evaluated from the grey histogram (median, 1/99th
percentiles, clipped fractions). A specular mask combines absolute HSV thresholds with a local-contrast
condition and morphological opening; both its total area and its largest connected component (a
ring-light hotspot) are measured. A 128-px tile grid marks unusable tiles (glare, blur, clipping); flat
tiles are not judged for focus. All thresholds are exposed at `GET /api/agent/policies`.

**Pipeline B — candidates.**
*Suspected corrosion:* soft colour cues for blue-green copper salts (hue window + chroma + Lab b* gate
that excludes typical yellow-green solder mask) and pale crust (high L, low chroma), multiplied by a
texture cue — band-pass (difference-of-Gaussians) RMS energy gated by structure-tensor coherence, so
granular, isotropic deposits score high while traces and edges do not. Components are filtered by area,
by interior texture (smooth objects with textured edges are rejected) and by overlap with metallic
surfaces. A brown-stain cue is measured but does not raise candidates: on real brown phenolic boards and
copper it produced false positives indistinguishable from damage.
*Suspected solder bridges:* a metallic mask (low chroma, locally bright in Lab) is decomposed into
components; elongated components are grouped into IC lead rows by orientation and position, rows are
validated by regular pitch and lead geometry (length > 1.1 × pitch, width < 0.8 × pitch), and two
anomalies are flagged: a metallic blob spanning more than one lead position (merged leads) and an
inter-lead gap whose brightness is a robust outlier (median/MAD z ≥ 3.5) *and* approaches lead brightness.
Every candidate carries its measurements, a heuristic evidence score (not a probability) and a
region-level evidence-quality record (local glare, local blur, exposure, and lead resolution in pixels).

**Pipeline C — registration.** SIFT (4000 features) with FLANN and Lowe's ratio test, ORB as a fallback,
homography estimation with `cv2.USAC_MAGSAC`. Status is derived from measured inlier count, inlier ratio,
RMS reprojection error, inlier convex-hull coverage and transform plausibility (positive determinant,
scale range, perspective terms, convex warped frame). FAILED results carry no homography, and the UI
withholds every overlay.

**Pipeline D — change.** The registered image is photometrically normalised to the reference in Lab
(mean/std on the valid overlap). Change combines a shift-tolerant colour difference (minimum ΔE over
±2 px translations, absorbing residual misregistration) and 1−SSIM computed with Gaussian windows;
thresholding uses Otsu with an absolute floor, followed by morphology and connected components. Change
is linked to each prior finding (changed pixels in its box, and whether it is still detected after).

**Pipeline E — multi-view.** Earlier findings are mapped into the new view through the inverse
homography, local evidence is re-measured there, and detection results are matched by IoU.

## 4. Agent

A transparent state machine (`CAPTURE_RECEIVED … COMPLETED / FAILED_SAFELY`) whose transitions are
produced by pure policy functions with rule ids (R-Q1…R-V3). Tools have explicit contracts
(`GET /api/agent/tools`). Every tool call, decision, action and human input is appended to a trace with
timestamp, state transition, inputs, observations, trigger rule, next action and duration; the trace is
downloadable as JSON and summarised in the report.

Invariants (unit- and evaluation-tested): quality-rejected captures are never analysed for defects; no
finding is cleared without a technician decision; failed registration never yields an overlay; at most
two agent-initiated recaptures per inspection.

The technician has tools of their own. A *region evidence check* runs the same region-level measurements
(glare, Crete blur, exposure, lead width in pixels) on any rectangle they draw; it is traced as a
technician-initiated tool call and never changes the state. A confirm/dismiss can be *withdrawn* while
its review is still the current step (rule R-H2), with the withdrawal kept in the trace. Measurements can
be calibrated to millimetres from a detected lead row with a known package pitch: on Scenario 02 a
0.5 mm TQFP-144 pitch gives 0.0147 mm/px, which puts the 20 mm package body at about 1,360 px, as
observed.

Example (Scenario 02, real TQFP-144 photo): a ring-light hotspot on the right lead row creates a
merged-lead suspicion whose local glare is 28 % → rule R-E1 → "Reduce specular glare … switch to diffuse
or polarised illumination … keep the same field of view". The diffuse recapture registers with ~3.9k MAGSAC
inliers; the glare suspicion is *not reproduced* (R-M3, priority lowered, still requires acknowledgment)
while a second candidate — a fibre lying across two leads — *persists* (R-M2, priority raised).

## 5. AWS

One container image holds the API, OpenCV 5 and the static UI. It runs on **AWS Lambda** (container image,
Lambda Web Adapter, 3008 MB, reserved concurrency 5) behind a **Function URL**; captures, derived artifacts
and session state live in a private **S3** bucket (SSE-S3, public access blocked, 7-day lifecycle expiry,
presigned URLs for the browser) so any Lambda instance can continue any inspection; **CloudWatch Logs**
receives per-request processing logs; **ECR** stores images (scan on push). IAM is least-privilege
(S3 Get/Put on one prefix, log writes). The whole stack is one CloudFormation template plus a deploy and a
verification script (`infrastructure/aws`). Deployment status: see `docs/submission/STATUS.md`.

**Live demo (Vercel).** The same API code runs at https://boardguard-three.vercel.app as one Python
Function (zero-config FastAPI), with the static UI on Vercel's CDN. Function instances do not share
`/tmp`, so captures, overlays and session state are mirrored into Vercel's regional Runtime Cache and
sessions are always read from it. Any instance can therefore continue any inspection, which plays the
role S3 plays on AWS.

## 6. Data

27 Wikimedia Commons photographs (CC0 / Public Domain / CC BY-SA), licence-checked through the Commons API
and visually reviewed; manifest with attribution in `datasets/raw/manifest.json`. No ground-truth defect
annotations exist for them and none were invented. Public PCB defect datasets were considered and not used
(DeepPCB: conflicting MIT licence vs. research-only README; PKU: academic use only, synthetic defects).
Demo fixtures that are synthetic (added glare; digitally cleaned + re-framed after-image) are labelled as
such in the UI, trace and report.

## 7. Evaluation (measured, reproducible: `scripts/evaluate.py`)

See `docs/evaluation/results.md` for full tables and failure cases. Highlights from the latest run:

| Aspect | Method | Result |
|---|---|---|
| Blur detection | 27 real photos, Gaussian σ = 3 / 5 px | 100 % / 100 % flagged (σ = 1.5: 96 %) |
| Exposure | ×0.13 / ×1.9+70 | 100 % / 100 % flagged |
| Glare | one synthetic specular hotspot per photo | 100 % flagged (hotspot metric) |
| Bridge localisation | 48 synthetic renderings, exact GT, random homography | precision 1.0, recall 1.0 |
| Corrosion localisation | same | precision 1.0, recall 0.79 |
| Corrosion on real photos (indicative, no GT) | candidates per category | 4/7 corrosion photos, 1/8 clean photos, 0/4 PSU photos |
| Registration | 81 known-homography warps of real photos | 100 % registered, median max-corner error 0.09 px (worst 0.52 px) |
| Registration rejection | 23 unrelated real photo pairs | 23/23 correctly FAILED |
| Change detection | 15 synthetic pairs + 15 no-change controls | 22/22 removed defects marked; 0 spurious regions |
| Agent | 9 scripted scenarios via HTTP API | 9/9 expected actions; 0 unsafe automatic conclusions |
| Reinspection benefit | 10 glare-ambiguous cases (5 with a real bridge) | naive single image wrong 5/10; after one targeted recapture 10/10 correct |

Limitations of this evaluation: no real repair dataset with ground truth; synthetic data cannot represent
the variety of real boards; the reinspection benefit is measured on synthetic glare.

## 8. Responsible use

BoardGuard is a visual inspection aid. It never claims electrical continuity or repair success; the
completion state is "Visual reinspection completed · Visible changes documented · Electrical verification
pending". Findings are *suspected visual anomalies*; scores are heuristic. Inconclusive and stopped-safely
outcomes are first-class results. Synthetic material is labelled. The 3D board is a representative model.
No technician identity is fabricated; demo actions are attributed to an unauthenticated user. Uploaded
evidence expires from S3 after seven days.

## 9. Limitations and next steps

* Classical detectors with hand-calibrated thresholds; next: a small learned model trained on a properly
  licensed, annotated corpus of real repair imagery (collected with shops, with consent).
* Planar homography; next: local refinement (ECC / optical flow) for parallax around tall parts.
* Physical scale today comes from a known lead pitch or a ruler over a known distance, valid in that plane
  only; next: stage-micrometer calibration and perspective correction.
* Brown staining and eaten traces are not localised.
