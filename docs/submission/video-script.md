# Demo video — how it is made (≤ 5 min)

The video is generated from this repository by `scripts/video/` so every shot can be reproduced:

| Step | Script | What it does |
|---|---|---|
| Narration | `tts.py` + `narration.json` | Kokoro-82M (open-weight, Apache-2.0) synthetic voice, one WAV per segment; the captions use the same text |
| App footage | `record-app.mjs` | Drives the real workstation (single-origin production build, OpenCV 5.0.0 processing live) with Playwright and records it through a Chrome DevTools screencast. The narration paces the run; camera moves are CSS zooms, so text stays sharp. Unnarrated navigation is fast-forwarded 3× in the edit and labelled on screen |
| Motion graphics | `cards.html` + `render-cards.mjs` | Hook, title, agent loop, AWS architecture, results, limits and team cards, rendered frame by frame at 30 fps |
| Music | `music.py` | A 112 BPM bed synthesised in numpy (no samples, nothing to license), ducked under the voice |
| Edit | `build.py` | Cuts the recordings to the narration, burns in captions, mixes voice and music, checks the 5-minute limit |

## Running order

| Section | Shot | Narration (abridged) |
|---|---|---|
| Hook | Licensed PCB photos under a microscope reticle: glare, blur, 0.5 mm pitch | Glare, blur and half-millimetre leads turn every photo into a guess |
| Title | BoardGuard logo and tagline | An AI microscope assistant that knows when to look again |
| Agent loop | Perceive (OpenCV 5) → decide (16 rules) → act (request a better look) → human | When the evidence is weak, it asks for a better look instead of guessing |
| S02 | 3D board → TQFP-144 under a ring light; C01 in a hotspot (28 % glare), glare mask | Two suspected bridges; C01 sits inside a specular hotspot |
| Region check | `R`, drag over the hotspot → *insufficient · glare* | Technicians can check any region themselves |
| R-E1 | Next-action card: diffuse light, same framing | The agent will not decide on that evidence |
| Reinspection | Diffuse recapture → registered (SIFT + MAGSAC) → C01 not reproduced, C02 persists (a fibre across two leads) | Every finding is checked again |
| Ruler | `M`, calibrate from the 0.5 mm lead pitch → package body ≈ 19.7 mm | The ruler reads in millimetres |
| Decisions | Dismiss C01 → Undo (R-H2) → dismiss → confirm C02 → electrical verification pending | The technician makes the call; BoardGuard never claims an electrical result |
| Trace | Evidence screen with tool inputs/outputs | Every tool call, rule and human decision is traced |
| S03 | Before/after split slider, difference map, completion | Visible change documented; electrical verification stays with the technician |
| S05 | Real rework pair → registration failed, overlay withheld | When alignment is unreliable, BoardGuard says so |
| Architecture | Browser → Lambda Function URL → Lambda (FastAPI, agent, OpenCV 5) → S3, CloudWatch; one CloudFormation stack | The whole stack deploys from one template |
| System | Live runtime identity and processing probe | OpenCV 5.0.0 running live |
| Results | 81/81 warps, 0.09 px, 23/23 rejected, 5/10 → 10/10 glare cases, 9/9 scenarios, 0 unsafe conclusions | We measured it |
| Limits, team | Not an electrical tester, not a validated diagnostic; team, links | A visual inspection aid that knows when to look again |

Reproduce (from the repo root, with the API serving the static UI on port 8090):

```bash
python -I scripts/video/tts.py <kokoro-models> scripts/video/narration.json <work>/narration
node scripts/video/record-app.mjs main http://127.0.0.1:8090 <work>/narration <work>/rec-main
node scripts/video/record-app.mjs system <deployed-url> <work>/narration <work>/rec-system
node scripts/video/render-cards.mjs <work>/narration <work>/cards
python -I scripts/video/build.py <work> scripts/video/narration.json docs/submission/video/boardguard-demo.mp4
```

The published cut uses `narration-vercel.json`, whose architecture and System lines describe the Vercel live
demo and the AWS template accurately while the AWS deployment is pending; `narration.json` holds the wording for
a cut recorded against the deployed AWS Lambda stack.
