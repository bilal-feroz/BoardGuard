# BoardGuard architecture

## Components

```mermaid
flowchart LR
  subgraph Browser["Workstation UI (Next.js 16 static export)"]
    B3D["3D board explorer<br/>React Three Fiber"]
    MIC["Microscope canvas<br/>zoom · pan · measure · layers"]
    INS["Inspector + technician controls"]
    TL["Timeline · Evidence trace"]
    VER["Before/after verification"]
  end
  subgraph AWS["AWS (one container image)"]
    URL["Lambda Function URL<br/>(public, rate-limited, 6 MB cap)"]
    LWA["Lambda Web Adapter"]
    API["FastAPI · vision API"]
    AG["Inspection agent<br/>state machine + policies"]
    CV["OpenCV 5 pipelines<br/>quality · candidates · registration · change · multi-view"]
    S3[("S3 evidence store<br/>private · SSE · 7-day expiry")]
    CW[("CloudWatch Logs")]
  end
  Browser -- "HTTPS /api/*" --> URL --> LWA --> API --> AG --> CV
  API -- "captures, artifacts, sessions" --> S3
  API -- "request logs" --> CW
  Browser -- "presigned GET (artifacts)" --> S3
```

The same image runs locally (`docker run -p 8080:8080`), so the judged
behaviour is identical on a laptop and on AWS. The UI is a static export
served by the same FastAPI app, so a single Function URL serves both.

The live demo runs the same code on **Vercel**: the static export is served
from Vercel's CDN (`public/`) and the FastAPI app (`app/main.py`) runs as one
Python Function via Vercel's zero-config FastAPI support, so the UI again
calls `/api/*` on its own origin (`infrastructure/vercel`).

## OpenCV processing flow

```mermaid
flowchart TD
  IN["Upload / USB microscope / recorded capture"] --> DEC["decode_image<br/>magic-byte check · size caps · working res ≤1600 px"]
  DEC --> Q["Pipeline A · assess_image_quality<br/>Crete blur · Laplacian · Tenengrad · specular mask · exposure · tiles"]
  Q -->|REJECT| RC1["request_recapture (R-Q1) — no defect analysis on bad evidence"]
  Q -->|ACCEPT / MARGINAL| C["Pipeline B · detect_visual_candidates"]
  C --> C1["corrosion: colour cues (verdigris / pale crust) × texture<br/>(DoG energy, structure-tensor coherence) · interior-texture check"]
  C --> C2["bridges: metallic mask → lead rows (orientation, pitch, geometry)<br/>merged-lead spans · anomalous bright gaps (robust z)"]
  C1 & C2 --> EQ["region evidence quality: glare · blur · exposure · lead resolution"]
  EQ --> AGT["agent policies"]
  AGT -->|second observation| R["Pipeline C · register_image_pair<br/>SIFT / ORB · ratio test · USAC MAGSAC homography · plausibility"]
  R -->|FAILED| W["comparison withheld (R-M1 / R-V2)"]
  R -->|REGISTERED / WEAK| MV["Pipeline E · compare_observations<br/>map candidates · re-measure · persisted / not reproduced / inconclusive"]
  R --> D["Pipeline D · compute_change_map<br/>Lab normalisation · shift-tolerant ΔE · 1−SSIM · Otsu · components"]
```

## Agent state machine

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> CAPTURE_RECEIVED: capture
  CAPTURE_RECEIVED --> QUALITY_ASSESSMENT
  QUALITY_ASSESSMENT --> RECAPTURE_REQUESTED: R-Q1 quality reject
  QUALITY_ASSESSMENT --> FAILED_SAFELY: R-Q2 budget exhausted
  QUALITY_ASSESSMENT --> INSPECTION_REQUIRED: R-Q3 pass
  INSPECTION_REQUIRED --> CANDIDATE_DETECTED: candidates
  INSPECTION_REQUIRED --> TECHNICIAN_REVIEW_REQUIRED: R-N1 none (acknowledge, not clearance)
  CANDIDATE_DETECTED --> EVIDENCE_INSUFFICIENT: R-E1 glare/blur/resolution
  EVIDENCE_INSUFFICIENT --> RECAPTURE_REQUESTED
  CANDIDATE_DETECTED --> TECHNICIAN_REVIEW_REQUIRED: R-E2 adequate evidence
  RECAPTURE_REQUESTED --> SECOND_OBSERVATION_RECEIVED: new capture
  RECAPTURE_REQUESTED --> TECHNICIAN_REVIEW_REQUIRED: technician declines (R-E3)
  SECOND_OBSERVATION_RECEIVED --> COMPARISON_COMPLETE: register + compare
  COMPARISON_COMPLETE --> RECAPTURE_REQUESTED: R-M1 / R-M4
  COMPARISON_COMPLETE --> TECHNICIAN_REVIEW_REQUIRED: R-M2 persisted / R-M3 not reproduced
  TECHNICIAN_REVIEW_REQUIRED --> VERIFICATION_PENDING: confirmed findings
  TECHNICIAN_REVIEW_REQUIRED --> COMPLETED: all dismissed / acknowledged
  VERIFICATION_PENDING --> VERIFICATION_PENDING: after capture → R-V3 change documented / R-V2 withheld
  VERIFICATION_PENDING --> COMPLETED: technician confirms visual checks
  COMPLETED --> [*]
  FAILED_SAFELY --> [*]
```

Policies are pure functions in `services/vision-api/app/agents/policies.py`;
every transition in the trace cites its rule id. Invariants enforced in code
and tests:

* a capture that fails the quality gate is never analysed for defects;
* no finding is cleared without a technician decision (even "no findings"
  needs acknowledgment);
* a failed registration never yields an overlay or change map;
* at most two agent-requested recaptures per inspection (no loops).

## Tools (explicit contracts, `GET /api/agent/tools`)

`assess_image_quality`, `extract_region_of_interest`, `detect_visual_candidates`,
`analyze_candidate_region`, `register_image_pair`, `compare_observations`,
`compute_change_map`, `request_recapture`, `request_technician_review`,
`record_verification`, `generate_inspection_report`.

## Storage

| Backend | When | Captures / artifacts | Sessions |
|---|---|---|---|
| Local filesystem | development | `services/vision-api/var/store` | JSON files |
| S3 | `BOARDGUARD_S3_BUCKET` set (AWS) | private objects, SSE-S3, served by 1-hour presigned URLs | JSON objects, so any Lambda instance can continue any inspection |
| `/tmp` + Vercel Runtime Cache | `VERCEL` set (live demo) | written to the instance's `/tmp` and mirrored (base64) into the regional Runtime Cache, 24 h TTL; served through `/api/artifacts` | always read from the shared cache first, so any function instance continues any inspection |

The bucket has a lifecycle rule that deletes `boardguard/` objects after 7 days.

## Security boundaries

* No credentials in the frontend; the browser only ever sees presigned artifact URLs.
* Uploads: magic-byte format check (JPEG/PNG/WebP/BMP/TIFF), 8 MB cap (5 MB on AWS),
  decompression-bomb limit (`OPENCV_IO_MAX_IMAGE_PIXELS`), minimum size, storage keys validated
  against a strict pattern (no path traversal); inspection ids validated by regex.
* Abuse limits: per-IP POST rate limit, Lambda reserved concurrency (5), 60 s timeout.
* Optional shared key (`BOARDGUARD_API_KEY` → `X-BoardGuard-Key`) for private deployments.
* IAM role: `s3:GetObject`/`s3:PutObject` on `bucket/boardguard/*` and log writes only.
* Container runs as an unprivileged user.

## Human-in-the-loop controls

Technician actions (`POST /api/inspections/{id}/actions`): confirm/dismiss a finding,
withdraw (undo) a decision while its review is still the current step (rule R-H2; also
when the last dismissal closed the inspection automatically, never after a new capture,
an explicit close or a verification), acknowledge a no-findings result, decline a
recapture, start before/after verification, confirm visual checks, record a
technician-entered electrical measurement, close or stop. Sessions expose
`undoable_decisions`.

Region evidence check (`POST /api/inspections/{id}/region-check` with an observation id and
a rectangle): runs `extract_region_of_interest` plus a lead-row analysis inside the area and
reports glare, focus, exposure and lead resolution. It is recorded in the trace as a
technician-initiated tool call and never changes the agent state or pending action.
The demo has no authentication, so actions are attributed to an "unauthenticated demo user";
no names or signatures are generated.
