# Devpost submission draft — BoardGuard

**Title:** BoardGuard — AI microscope assistant for electronics repair

**Elevator pitch (≤200 chars):** An OpenCV 5 inspection agent for repair technicians: it measures every microscope capture, asks for a better look when glare or blur hides the truth, and verifies before/after repairs.

**Try it:** https://boardguard-three.vercel.app (five built-in scenarios; every analysis runs live with OpenCV 5)

## Inspiration

Repair technicians spend hours under digital microscopes hunting for corrosion and solder bridges on
boards they have never seen before. The hardest moments are not the clear defects. They are the
ambiguous ones, like a ring-light reflection that looks exactly like a bridge between two 0.5 mm leads.
A good technician's answer is "let me look again with different light", not "probably a short". We
wanted software that behaves the same way.

## What it does

* Measures each capture (focus, glare, exposure, contrast, unusable tiles) and refuses to analyse
  unusable evidence.
* Localises **suspected** corrosion and solder bridges with OpenCV, and checks whether the local evidence
  around each one is good enough to support a decision.
* When it is not, the agent requests a **specific** new observation: diffuse light, refocus, more
  magnification, same framing. It then registers the new capture to the old one and records whether
  each finding *persisted*, was *not reproduced*, or is *still inconclusive*.
* Hands every finding to the technician with a recommended electrical check. It never auto-clears
  anything and never claims continuity.
* Registers before/after-repair captures, shows a split slider, synced views and a difference map, maps
  visible change onto findings, and withholds overlays when alignment is unreliable.
* Records a full evidence trace and produces a printable report.
* Lets you navigate a detailed 3D logic board and fly into a region to open its microscope view.
* Gives the technician their own tools: drag any area to check its evidence quality (glare, focus,
  exposure, lead resolution), measure in millimetres after calibrating from a known IC lead pitch, and undo
  a confirm/dismiss while the review is still open. Every step lands in the trace.

## How we built it

* **OpenCV 5.0.0** (`opencv-python-headless`) for everything visual:
  * Crete blur metric, Laplacian and Tenengrad measures
  * specular masks and connected components
  * Lab/HSV colour cues, difference-of-Gaussians texture energy and structure-tensor coherence
  * lead-row geometry with `minAreaRect`
  * SIFT/ORB features with **USAC MAGSAC** homographies
  * shift-tolerant ΔE + SSIM change maps
  * `cv2.inpaint` for a labelled synthetic fixture
* **Agent:** a policy-driven state machine in Python. Its tools have explicit contracts and its
  rule-cited decisions are unit-tested.
* **FastAPI** service; **Next.js 16 + React Three Fiber** workstation UI.
* **Live demo on Vercel:** the static UI on the CDN and the FastAPI/OpenCV 5 service as one Python
  Function; inspections are shared between function instances through Vercel's Runtime Cache.
* **AWS:** **Lambda** behind a Function URL (Python 3.12 zip, or one container with the Lambda Web
  Adapter), a private **S3** evidence store with 7-day expiry, **CloudWatch** logs and **ECR**, all in one
  CloudFormation template with a one-command deploy and a verification script (`infrastructure/aws`).
* 27 licence-checked Wikimedia Commons photographs plus a reproducible evaluation script.

## Challenges we ran into

* **Real data.** No licensed dataset of real repair damage exists. The public PCB defect sets are
  factory defects with restrictive or conflicting licences. We documented every image's licence and
  never invented ground truth.
* **Calibrating on real photos.** The first corrosion detector fired on nearly every real board:
  brown phenolic laminate, tin-plated capacitor terminations, IC leads. Fixing that took texture-interior
  checks, metallic-surface suppression, and dropping a cue that could not be made reliable.
* **Honest registration.** Our genuine before/after rework pair is shot from different angles. The
  right behaviour is to refuse to overlay it, and BoardGuard does.

## Accomplishments that we're proud of

* An actual perception → decision → action loop:
  * vision outputs choose the next tool call or request;
  * a second observation is genuinely processed;
  * the decision changes for measured reasons, with the rule cited in the trace.
* Zero unsafe automatic conclusions across the evaluation scenarios.
* Registration accurate to 0.09 px median corner error on 81 known warps of real photos.

## What we learned

The most valuable output of a vision system in a repair shop is often "this evidence is not good
enough, here is how to get better evidence". Making uncertainty actionable matters more than adding
classes.

## What's next

* Collect a consented, annotated corpus of real repair imagery with partner shops and train a small
  learned detector behind the same agent.
* Stage-micrometer calibration and perspective correction (today the scale comes from a known lead pitch
  or a ruler over a known distance).
* Local (non-planar) registration refinement.
* Integration with USB microscope controls (focus, illumination) so the agent's requests can be carried
  out by the instrument.

## Built with

opencv, python, fastapi, numpy, vercel, aws-lambda, amazon-s3, amazon-cloudwatch, amazon-ecr, aws-cloudformation,
docker, next.js, react, typescript, three.js, react-three-fiber, tailwindcss, playwright
