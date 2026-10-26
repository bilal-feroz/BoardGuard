# BoardGuard evaluation results

Generated 2026-10-26 19:57 UTC with OpenCV 5.0.0 (local · Windows 10 · Python 3.11.16) in 274.9 s.

Reproduce: `services/vision-api/.venv/Scripts/python scripts/evaluate.py`


## Quality gate on controlled degradations of real photographs

**Method.** Each licensed real PCB photograph is degraded in a known way (Gaussian blur sigma 1.5/3/5 px, synthetic specular highlight, x0.13 exposure, x1.9+70 gain). A degradation counts as detected when the matching reason code is raised. Originals have no quality ground truth; their verdicts are reported, not scored.

**Data.** 27 images from datasets/raw (Wikimedia Commons, see licences).

| Metric | Value |
|---|---|
| real source images | 27 |
| flagged: blur_s1.5 | 96.3 % |
| flagged: blur_s3 | 100.0 % |
| flagged: blur_s5 | 100.0 % |
| flagged: glare | 100.0 % |
| flagged: dark | 100.0 % |
| flagged: bright | 100.0 % |
| originals ACCEPT/MARGINAL/REJECT | 17/7/3 |

| image | original verdict | blur metric | blur metric @ sigma 3 |
|---|---|---|---|
| corrosion/corrosion_01_nicd-leak-korg-poly61.jpg | ACCEPT | 0.428 | 0.796 |
| corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg | ACCEPT | 0.409 | 0.802 |
| corrosion/corrosion_03_polysix-battery-trace-damage.jpg | ACCEPT | 0.327 | 0.742 |
| corrosion/corrosion_04_386-motherboard-battery-leak.jpg | REJECT | 0.294 | 0.763 |
| corrosion/corrosion_05_acorn-a3000-full-board.jpg | ACCEPT | 0.24 | 0.701 |
| corrosion/corrosion_06_hdd-pcb-oxidized-pads-subtle.jpg | ACCEPT | 0.259 | 0.71 |
| corrosion/corrosion_07_nicd-button-cell-terminal.jpg | ACCEPT | 0.406 | 0.757 |
| fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg | ACCEPT | 0.315 | 0.761 |
| fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg | ACCEPT | 0.341 | 0.791 |
| fine_pitch/fine_pitch_03_tssop48-idt-topdown.jpg | ACCEPT | 0.238 | 0.778 |
| fine_pitch/fine_pitch_04_hsop-wave-solder-thieves.jpg | ACCEPT | 0.349 | 0.765 |
| fine_pitch/fine_pitch_05_ssop28-ftdi-oblique.jpg | MARGINAL | 0.416 | 0.836 |
| fine_pitch/fine_pitch_06_lqfp48-realtek-angle-a.jpg | MARGINAL | 0.45 | 0.773 |
| fine_pitch/fine_pitch_07_lqfp48-realtek-angle-b.jpg | MARGINAL | 0.472 | 0.807 |
| fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg | REJECT | 0.226 | 0.673 |
| clean/clean_01_microscope-smd-glare-shield.jpg | REJECT | 0.222 | 0.742 |
| clean/clean_02_microscope-msop10-passives.jpg | MARGINAL | 0.206 | 0.714 |
| clean/clean_03_lqfp48-infineon-router-board.jpg | MARGINAL | 0.277 | 0.742 |
| clean/clean_04_mlcc-capacitors-macro.jpg | ACCEPT | 0.275 | 0.79 |
| clean/clean_05_mlcc-led-macro-1mm-scalebar.jpg | MARGINAL | 0.219 | 0.746 |
| clean/clean_06_soic8-opamps-black-pcb.jpg | ACCEPT | 0.402 | 0.77 |
| clean/clean_07_qfn60-rp2350-pico2.jpg | MARGINAL | 0.353 | 0.741 |
| clean/clean_08_hdd-pcb-traces-testpoints.jpg | ACCEPT | 0.327 | 0.72 |
| pairs/pairs_01_sharp-psu-before-closeup.jpg | ACCEPT | 0.366 | 0.769 |
| pairs/pairs_02_sharp-psu-after-closeup.jpg | ACCEPT | 0.361 | 0.789 |
| pairs/pairs_03_sharp-psu-before-wide.jpg | ACCEPT | 0.295 | 0.783 |
| pairs/pairs_04_sharp-psu-after-wide.jpg | ACCEPT | 0.278 | 0.788 |

**Failure cases / limitations**

- Original corrosion/corrosion_04_386-motherboard-battery-leak.jpg rejected (OVEREXPOSED, GLARE); no ground truth that it is usable - review manually.
- Original fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg rejected (TOO_SMALL); no ground truth that it is usable - review manually.
- Original clean/clean_01_microscope-smd-glare-shield.jpg rejected (OVEREXPOSED, GLARE); no ground truth that it is usable - review manually.

## Candidate localisation

**Method.** Synthetic boards with exact ground truth (randomised bridge position/row, corrosion position/size/colour), each warped by a random homography with a gain change; a detection matches at IoU >= 0.2. Real photographs have no localisation ground truth, so only per-category candidate counts are reported.

**Data.** 48 synthetic renderings (12 per class mix); 27 real photographs (indicative only).

| Metric | Value |
|---|---|
| bridge precision | 1.0 |
| bridge recall | 1.0 |
| corrosion precision | 1.0 |
| corrosion recall | 0.792 |
| median detection time | 223.2 ms |
| real 'clean': images with corrosion cand. | 1/8 |
| real 'corrosion': images with corrosion cand. | 4/7 |
| real 'fine_pitch': images with corrosion cand. | 1/8 |
| real 'pairs': images with corrosion cand. | 0/4 |

| real image | category | corrosion cand. | bridge cand. | insufficient evidence |
|---|---|---|---|---|
| corrosion/corrosion_01_nicd-leak-korg-poly61.jpg | corrosion | 7 | 0 | 0 |
| corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg | corrosion | 2 | 0 | 1 |
| corrosion/corrosion_03_polysix-battery-trace-damage.jpg | corrosion | 1 | 0 | 0 |
| corrosion/corrosion_04_386-motherboard-battery-leak.jpg | corrosion | 0 | 0 | 0 |
| corrosion/corrosion_05_acorn-a3000-full-board.jpg | corrosion | 0 | 0 | 0 |
| corrosion/corrosion_06_hdd-pcb-oxidized-pads-subtle.jpg | corrosion | 2 | 3 | 1 |
| corrosion/corrosion_07_nicd-button-cell-terminal.jpg | corrosion | 0 | 0 | 0 |
| fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg | fine_pitch | 0 | 1 | 0 |
| fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg | fine_pitch | 0 | 0 | 0 |
| fine_pitch/fine_pitch_03_tssop48-idt-topdown.jpg | fine_pitch | 0 | 0 | 0 |
| fine_pitch/fine_pitch_04_hsop-wave-solder-thieves.jpg | fine_pitch | 0 | 1 | 1 |
| fine_pitch/fine_pitch_05_ssop28-ftdi-oblique.jpg | fine_pitch | 6 | 0 | 0 |
| fine_pitch/fine_pitch_06_lqfp48-realtek-angle-a.jpg | fine_pitch | 0 | 0 | 0 |
| fine_pitch/fine_pitch_07_lqfp48-realtek-angle-b.jpg | fine_pitch | 0 | 1 | 0 |
| fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg | fine_pitch | 0 | 0 | 0 |
| clean/clean_01_microscope-smd-glare-shield.jpg | clean | 0 | 0 | 0 |
| clean/clean_02_microscope-msop10-passives.jpg | clean | 0 | 0 | 0 |
| clean/clean_03_lqfp48-infineon-router-board.jpg | clean | 1 | 0 | 0 |
| clean/clean_04_mlcc-capacitors-macro.jpg | clean | 0 | 0 | 0 |
| clean/clean_05_mlcc-led-macro-1mm-scalebar.jpg | clean | 0 | 0 | 0 |
| clean/clean_06_soic8-opamps-black-pcb.jpg | clean | 0 | 0 | 0 |
| clean/clean_07_qfn60-rp2350-pico2.jpg | clean | 0 | 0 | 0 |
| clean/clean_08_hdd-pcb-traces-testpoints.jpg | clean | 0 | 0 | 0 |
| pairs/pairs_01_sharp-psu-before-closeup.jpg | pairs | 0 | 0 | 0 |
| pairs/pairs_02_sharp-psu-after-closeup.jpg | pairs | 0 | 0 | 0 |
| pairs/pairs_03_sharp-psu-before-wide.jpg | pairs | 0 | 0 | 0 |
| pairs/pairs_04_sharp-psu-after-wide.jpg | pairs | 0 | 0 | 0 |

**Failure cases / limitations**

- seed 128 (corrosion): missed suspected_corrosion
- seed 129 (corrosion): missed suspected_corrosion
- seed 130 (corrosion): missed suspected_corrosion
- seed 135 (corrosion): missed suspected_corrosion
- seed 141 (bridge+corrosion): missed suspected_corrosion
- Real-image counts are not accuracy: corrosion-like colour/texture on clean boards (e.g. pale silkscreen, flux residue, teal solder mask) can raise candidates, and real bridges under different geometry can be missed.

## Image registration (SIFT/ORB + MAGSAC homography)

**Method.** Each real photograph is warped by a random plausible homography (rotation <= 8 deg, scale +/- 8 %, shift <= 4 % width, mild perspective) plus gain/offset change; error = max distance between estimated and true image-corner positions. Negative pairs are consecutive unrelated photographs.

**Data.** 27 real photographs x 3 warps; 23 unrelated pairs.

| Metric | Value |
|---|---|
| known-warp pairs | 81 |
| registered (REGISTERED/WEAK) | 100.0 % |
| median max-corner error | 0.09 px |
| worst max-corner error | 0.52 px |
| unrelated pairs correctly FAILED | 23/23 |
| median registration time | 682.2 ms |

| image | warp | status | inliers | inlier ratio | RMS px | corner err px |
|---|---|---|---|---|---|---|
| corrosion/corrosion_01_nicd-leak-korg-poly61.jpg | 0 | REGISTERED | 2529 | 0.978 | 0.45 | 0.13 |
| corrosion/corrosion_01_nicd-leak-korg-poly61.jpg | 1 | REGISTERED | 2597 | 0.982 | 0.41 | 0.2 |
| corrosion/corrosion_01_nicd-leak-korg-poly61.jpg | 2 | REGISTERED | 2612 | 0.986 | 0.45 | 0.11 |
| corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg | 0 | REGISTERED | 2784 | 0.984 | 0.44 | 0.14 |
| corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg | 1 | REGISTERED | 2701 | 0.986 | 0.44 | 0.1 |
| corrosion/corrosion_02_nicd-leak-ic-socket-pins.jpg | 2 | REGISTERED | 2734 | 0.986 | 0.4 | 0.16 |
| corrosion/corrosion_03_polysix-battery-trace-damage.jpg | 0 | REGISTERED | 2497 | 0.964 | 0.33 | 0.08 |
| corrosion/corrosion_03_polysix-battery-trace-damage.jpg | 1 | REGISTERED | 2408 | 0.96 | 0.36 | 0.09 |
| corrosion/corrosion_03_polysix-battery-trace-damage.jpg | 2 | REGISTERED | 2534 | 0.969 | 0.36 | 0.18 |
| corrosion/corrosion_04_386-motherboard-battery-leak.jpg | 0 | REGISTERED | 2065 | 0.92 | 0.31 | 0.04 |
| corrosion/corrosion_04_386-motherboard-battery-leak.jpg | 1 | REGISTERED | 2027 | 0.944 | 0.31 | 0.09 |
| corrosion/corrosion_04_386-motherboard-battery-leak.jpg | 2 | REGISTERED | 2257 | 0.943 | 0.3 | 0.05 |
| corrosion/corrosion_05_acorn-a3000-full-board.jpg | 0 | REGISTERED | 2538 | 0.98 | 0.19 | 0.07 |
| corrosion/corrosion_05_acorn-a3000-full-board.jpg | 1 | REGISTERED | 2435 | 0.967 | 0.2 | 0.13 |
| corrosion/corrosion_05_acorn-a3000-full-board.jpg | 2 | REGISTERED | 2514 | 0.971 | 0.21 | 0.03 |
| corrosion/corrosion_06_hdd-pcb-oxidized-pads-subtle.jpg | 0 | REGISTERED | 2280 | 0.951 | 0.22 | 0.14 |
| corrosion/corrosion_06_hdd-pcb-oxidized-pads-subtle.jpg | 1 | REGISTERED | 2312 | 0.953 | 0.24 | 0.05 |
| corrosion/corrosion_06_hdd-pcb-oxidized-pads-subtle.jpg | 2 | REGISTERED | 2343 | 0.958 | 0.22 | 0.05 |
| corrosion/corrosion_07_nicd-button-cell-terminal.jpg | 0 | REGISTERED | 1823 | 0.987 | 0.47 | 0.52 |
| corrosion/corrosion_07_nicd-button-cell-terminal.jpg | 1 | REGISTERED | 2221 | 0.989 | 0.4 | 0.1 |
| corrosion/corrosion_07_nicd-button-cell-terminal.jpg | 2 | REGISTERED | 2216 | 0.987 | 0.41 | 0.11 |
| fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg | 0 | REGISTERED | 1775 | 0.929 | 0.33 | 0.05 |
| fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg | 1 | REGISTERED | 1554 | 0.907 | 0.41 | 0.09 |
| fine_pitch/fine_pitch_01_tqfp144-xilinx-topdown.jpg | 2 | REGISTERED | 1133 | 0.86 | 0.45 | 0.09 |
| fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg | 0 | REGISTERED | 2361 | 0.962 | 0.35 | 0.2 |
| fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg | 1 | REGISTERED | 2540 | 0.975 | 0.32 | 0.19 |
| fine_pitch/fine_pitch_02_tqfp64-pic18-topdown.jpg | 2 | REGISTERED | 2388 | 0.974 | 0.38 | 0.28 |
| fine_pitch/fine_pitch_03_tssop48-idt-topdown.jpg | 0 | REGISTERED | 2293 | 0.986 | 0.29 | 0.04 |
| fine_pitch/fine_pitch_03_tssop48-idt-topdown.jpg | 1 | REGISTERED | 2016 | 0.974 | 0.32 | 0.07 |
| fine_pitch/fine_pitch_03_tssop48-idt-topdown.jpg | 2 | REGISTERED | 2144 | 0.975 | 0.34 | 0.09 |
| fine_pitch/fine_pitch_04_hsop-wave-solder-thieves.jpg | 0 | REGISTERED | 2024 | 0.955 | 0.34 | 0.06 |
| fine_pitch/fine_pitch_04_hsop-wave-solder-thieves.jpg | 1 | REGISTERED | 2162 | 0.965 | 0.35 | 0.12 |
| fine_pitch/fine_pitch_04_hsop-wave-solder-thieves.jpg | 2 | REGISTERED | 2192 | 0.961 | 0.3 | 0.1 |
| fine_pitch/fine_pitch_05_ssop28-ftdi-oblique.jpg | 0 | REGISTERED | 2494 | 0.959 | 0.55 | 0.17 |
| fine_pitch/fine_pitch_05_ssop28-ftdi-oblique.jpg | 1 | REGISTERED | 2510 | 0.962 | 0.48 | 0.08 |
| fine_pitch/fine_pitch_05_ssop28-ftdi-oblique.jpg | 2 | REGISTERED | 2405 | 0.957 | 0.59 | 0.13 |
| fine_pitch/fine_pitch_06_lqfp48-realtek-angle-a.jpg | 0 | REGISTERED | 2556 | 0.973 | 0.31 | 0.09 |
| fine_pitch/fine_pitch_06_lqfp48-realtek-angle-a.jpg | 1 | REGISTERED | 2740 | 0.974 | 0.33 | 0.05 |
| fine_pitch/fine_pitch_06_lqfp48-realtek-angle-a.jpg | 2 | REGISTERED | 2605 | 0.972 | 0.26 | 0.18 |
| fine_pitch/fine_pitch_07_lqfp48-realtek-angle-b.jpg | 0 | REGISTERED | 2693 | 0.969 | 0.34 | 0.12 |
| fine_pitch/fine_pitch_07_lqfp48-realtek-angle-b.jpg | 1 | REGISTERED | 2582 | 0.971 | 0.52 | 0.11 |
| fine_pitch/fine_pitch_07_lqfp48-realtek-angle-b.jpg | 2 | REGISTERED | 2571 | 0.97 | 0.39 | 0.1 |
| fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg | 0 | REGISTERED | 1349 | 0.985 | 0.29 | 0.1 |
| fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg | 1 | REGISTERED | 1185 | 0.993 | 0.29 | 0.07 |
| fine_pitch/fine_pitch_08_solder-bridge-genuine-lowres.jpg | 2 | REGISTERED | 1133 | 0.984 | 0.36 | 0.21 |
| clean/clean_01_microscope-smd-glare-shield.jpg | 0 | REGISTERED | 1958 | 0.99 | 0.4 | 0.07 |
| clean/clean_01_microscope-smd-glare-shield.jpg | 1 | REGISTERED | 2475 | 0.992 | 0.37 | 0.06 |
| clean/clean_01_microscope-smd-glare-shield.jpg | 2 | REGISTERED | 2181 | 0.979 | 0.42 | 0.03 |
| clean/clean_02_microscope-msop10-passives.jpg | 0 | REGISTERED | 2258 | 0.992 | 0.34 | 0.04 |
| clean/clean_02_microscope-msop10-passives.jpg | 1 | REGISTERED | 2137 | 0.983 | 0.35 | 0.03 |
| clean/clean_02_microscope-msop10-passives.jpg | 2 | REGISTERED | 2007 | 0.973 | 0.4 | 0.07 |
| clean/clean_03_lqfp48-infineon-router-board.jpg | 0 | REGISTERED | 2349 | 0.964 | 0.39 | 0.11 |
| clean/clean_03_lqfp48-infineon-router-board.jpg | 1 | REGISTERED | 2432 | 0.961 | 0.35 | 0.07 |
| clean/clean_03_lqfp48-infineon-router-board.jpg | 2 | REGISTERED | 2406 | 0.962 | 0.38 | 0.05 |
| clean/clean_04_mlcc-capacitors-macro.jpg | 0 | REGISTERED | 2318 | 0.972 | 0.45 | 0.19 |
| clean/clean_04_mlcc-capacitors-macro.jpg | 1 | REGISTERED | 2311 | 0.969 | 0.5 | 0.14 |
| clean/clean_04_mlcc-capacitors-macro.jpg | 2 | REGISTERED | 2279 | 0.97 | 0.46 | 0.15 |
| clean/clean_05_mlcc-led-macro-1mm-scalebar.jpg | 0 | REGISTERED | 2095 | 0.968 | 0.53 | 0.04 |
| clean/clean_05_mlcc-led-macro-1mm-scalebar.jpg | 1 | REGISTERED | 2122 | 0.971 | 0.48 | 0.06 |
| clean/clean_05_mlcc-led-macro-1mm-scalebar.jpg | 2 | REGISTERED | 2005 | 0.965 | 0.53 | 0.07 |
| clean/clean_06_soic8-opamps-black-pcb.jpg | 0 | REGISTERED | 2690 | 0.957 | 0.36 | 0.08 |
| clean/clean_06_soic8-opamps-black-pcb.jpg | 1 | REGISTERED | 2728 | 0.958 | 0.35 | 0.1 |
| clean/clean_06_soic8-opamps-black-pcb.jpg | 2 | REGISTERED | 2697 | 0.956 | 0.34 | 0.1 |
| clean/clean_07_qfn60-rp2350-pico2.jpg | 0 | REGISTERED | 2656 | 0.988 | 0.27 | 0.1 |
| clean/clean_07_qfn60-rp2350-pico2.jpg | 1 | REGISTERED | 2666 | 0.987 | 0.28 | 0.04 |
| clean/clean_07_qfn60-rp2350-pico2.jpg | 2 | REGISTERED | 2625 | 0.988 | 0.3 | 0.12 |
| clean/clean_08_hdd-pcb-traces-testpoints.jpg | 0 | REGISTERED | 2232 | 0.965 | 0.51 | 0.09 |
| clean/clean_08_hdd-pcb-traces-testpoints.jpg | 1 | REGISTERED | 2375 | 0.972 | 0.49 | 0.05 |
| clean/clean_08_hdd-pcb-traces-testpoints.jpg | 2 | REGISTERED | 2282 | 0.973 | 0.5 | 0.08 |
| pairs/pairs_01_sharp-psu-before-closeup.jpg | 0 | REGISTERED | 2145 | 0.968 | 0.35 | 0.09 |
| pairs/pairs_01_sharp-psu-before-closeup.jpg | 1 | REGISTERED | 2132 | 0.971 | 0.3 | 0.08 |
| pairs/pairs_01_sharp-psu-before-closeup.jpg | 2 | REGISTERED | 2413 | 0.971 | 0.23 | 0.16 |
| pairs/pairs_02_sharp-psu-after-closeup.jpg | 0 | REGISTERED | 1949 | 0.957 | 0.49 | 0.11 |
| pairs/pairs_02_sharp-psu-after-closeup.jpg | 1 | REGISTERED | 2261 | 0.967 | 0.48 | 0.11 |
| pairs/pairs_02_sharp-psu-after-closeup.jpg | 2 | REGISTERED | 2064 | 0.961 | 0.41 | 0.05 |
| pairs/pairs_03_sharp-psu-before-wide.jpg | 0 | REGISTERED | 2579 | 0.981 | 0.45 | 0.15 |
| pairs/pairs_03_sharp-psu-before-wide.jpg | 1 | REGISTERED | 2456 | 0.985 | 0.41 | 0.07 |
| pairs/pairs_03_sharp-psu-before-wide.jpg | 2 | REGISTERED | 2776 | 0.987 | 0.4 | 0.13 |
| pairs/pairs_04_sharp-psu-after-wide.jpg | 0 | REGISTERED | 2315 | 0.963 | 0.43 | 0.15 |
| pairs/pairs_04_sharp-psu-after-wide.jpg | 1 | REGISTERED | 2360 | 0.961 | 0.45 | 0.07 |
| pairs/pairs_04_sharp-psu-after-wide.jpg | 2 | REGISTERED | 2334 | 0.957 | 0.44 | 0.07 |

## Change detection after registration

**Method.** Synthetic before/after pairs where a solder bridge (and, in half the pairs, a corrosion deposit) is removed and the after view is re-framed by a random homography. A removed defect counts as found when >3 % of its box is marked changed. Control: the same image re-framed with no content change.

**Data.** 15 synthetic pairs (+15 no-change controls).

| Metric | Value |
|---|---|
| removed defects marked changed | 22/22 |
| spurious regions on no-change controls | 0 |
| mean changed fraction on controls | 0.0 % |
| median change-map time | 424.5 ms |

**Failure cases / limitations**

- Not evaluated on real before/after repair pairs: no licensed matched pair of a physically repaired board was available.

## Agent behaviour and reinspection benefit

**Method.** Scripted scenarios through the real HTTP API and state machine; each has an expected next action/rule. Unsafe conclusion = a session COMPLETED without any technician action. Reinspection benefit: 10 glare-ambiguous cases (half with a real bridge) compare a naive single-image reading with the outcome after one targeted recapture.

**Data.** Synthetic captures with known content (labelled synthetic).

| Metric | Value |
|---|---|
| scenarios with expected action | 9/9 |
| unsafe automatic conclusions | 0 |
| single image: wrong bridge reading | 5/10 |
| after reinspection: correct persisted/not-reproduced | 10/10 |

| scenario | result | final state / last rule |
|---|---|---|
| blurred capture -> recapture, no analysis | pass | RECAPTURE_REQUESTED / R-Q1 |
| clear bridge -> technician review | pass | TECHNICIAN_REVIEW_REQUIRED / R-E2 |
| no findings -> acknowledgment (not clearance) | pass | TECHNICIAN_REVIEW_REQUIRED / R-N1 |
| glare suspicion, clean recapture -> not reproduced, review | pass | TECHNICIAN_REVIEW_REQUIRED / R-M3 |
| bridge under glare, clean recapture -> persisted, high priority | pass | TECHNICIAN_REVIEW_REQUIRED / R-M2 |
| unregistrable recapture -> comparison withheld | pass | RECAPTURE_REQUESTED / R-M1 |
| persistent blur -> stops safely after 2 recaptures | pass | FAILED_SAFELY / R-Q2 |
| before/after registered -> change documented, technician confirm | pass | VERIFICATION_PENDING / R-V3 |
| before/after unregistrable -> overlay withheld | pass | VERIFICATION_PENDING / R-V2 |

**Failure cases / limitations**

- Reinspection benefit is measured on synthetic glare, not on real microscope recaptures.

## Local processing latency

**Method.** Wall-clock time of each pipeline on the working-resolution images (longest side <= 1600 px), single process.

**Data.** 27 images; host: Intel64 Family 6 Model 140 Stepping 1, GenuineIntel / 8 logical CPUs; OpenCV threads 8.

| Metric | Value |
|---|---|
| quality median | 215.3 ms |
| quality p95 | 306.7 ms |
| candidates median | 465.2 ms |
| candidates p95 | 864.7 ms |
| typical working size | 1600x1200 |
