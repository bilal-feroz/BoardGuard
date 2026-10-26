# Demo video — script and shot list (≤ 5 min)

All footage is the running application recorded with Playwright (`scripts/record-demo.mjs`),
not mock-ups. Captions are generated from the same script so they align with the recorded events.
Narration lines below can be recorded by the team; the auto-generated cut uses captions only.

| Time | Shot (real app) | Narration / caption |
|---|---|---|
| 0:00–0:15 | Title, then the real battery-leak photo (S01) | Repair technicians inspect logic boards under microscopes. The hard cases are ambiguous: glare, blur, too little magnification. |
| 0:15–0:40 | 3D board overview, orbit, select REGION-B, camera flies in | BoardGuard is a workstation for that job. The board model is representative; each region links to real captures. |
| 0:40–1:20 | S02 first capture: quality gate, two candidates, glare layer on, C01 local evidence 28 % glare | OpenCV 5 measures the capture and localises two suspected bridges. One sits in a specular hotspot. The agent will not decide on that evidence. |
| 1:20–1:45 | Next-action card: rule R-E1, recapture instruction | It asks for a specific new look: diffuse light, same framing. |
| 1:45–2:25 | Provide diffuse recapture → registered (≈3.9k inliers) → C01 not reproduced (low), C02 persisted (high) | The new capture is registered to the first. The glare suspicion is not reproduced, and its priority drops. The other candidate, a fibre across two leads, persists, so it goes to the technician. |
| 2:25–2:45 | Technician dismisses C01, confirms C02 → "Electrical verification pending" | The technician decides. BoardGuard recommends a continuity check and never claims one. |
| 2:45–3:05 | Evidence screen: evidence chain and trace detail with tool contract | Every tool call, rule and human action is traced and exportable. |
| 3:05–3:45 | S03: split slider, difference map, findings-vs-change, confirm → completion | Before and after captures are registered and compared. Visible change is documented, and electrical verification stays pending. |
| 3:45–4:00 | S05: real rework pair → "Registration failed — overlay withheld" | When alignment is unreliable, BoardGuard says so instead of drawing a misleading overlay. |
| 4:00–4:25 | System screen: OpenCV 5.0.0 runtime, live probe (environment header), evaluation | Real OpenCV 5 processing, on AWS Lambda in deployment, with a reproducible evaluation. |
| 4:25–4:45 | Limitations card, tagline | What it is not: an electrical tester or a validated diagnostic. What it is: a visual inspection aid that knows when to look again. |

Team introduction: add authentic footage of the team if desired. None is fabricated in the generated cut.
