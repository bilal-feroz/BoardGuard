# BoardGuard image data

Finding representative, legally reusable motherboard-repair imagery was the
main data risk of this project. This folder documents exactly what was used.

## `raw/` — licensed source photographs

27 photographs from **Wikimedia Commons**, each with its licence read from the
Commons API (`extmetadata`) and recorded in [`raw/manifest.json`](raw/manifest.json)
(file, title, author, licence, licence URL, source page, size, what is visible).
Accepted licences only: CC0, Public Domain, CC BY, CC BY-SA. Images were
resized to at most 2000 px on the longest side. Every image was visually
reviewed; the `notes` field says what is visible and where.

| Category | Count | Image type | Typical content |
|---|---|---|---|
| `corrosion/` | 7 | Macro photos, consumer cameras | Battery-leak corrosion (blue-green crystals, green crust, eaten traces, white crust), one subtle tarnish case |
| `fine_pitch/` | 8 | Macro photos | TQFP-144/64, TSSOP-48, SSOP-28, LQFP-48 (same area from two angles), one low-res genuine through-hole solder bridge |
| `clean/` | 8 | Microscope and macro photos | Undamaged SMD areas incl. false-positive traps (glare, mottled MLCC terminations, flux flecks, black PCB) |
| `pairs/` | 4 | Macro photos | Genuine before/after capacitor replacement of the same PSU section (different angle and framing) |

**Licences:** CC0 / Public Domain (11), CC BY-SA 2.0 / 3.0 / 4.0 (16). Attribution
for each file is in the manifest and is shown in the application (System screen).

**Annotations:** none. No ground-truth defect labels exist for these images and
none were invented. Category labels are a visual review by the developers, not
expert annotation. They are used only for *indicative* per-category counts.

**Domain limitations:** most corrosion examples are battery-leak damage on older
through-hole boards, not liquid-spill damage on modern phone/laptop logic boards;
no licensed close-up of a fine-pitch solder bridge between IC leads was found;
no licensed before/after *cleaning* pair of a corroded board was found.

## `fixtures/` — judge demo captures

Built by `scripts/make_fixtures.py` from `raw/`:

| Fixture | Kind | Derived from |
|---|---|---|
| `s01_battery_leak` | Recorded | corrosion_01 |
| `s02_tqfp_ringlight` | **Synthetic**: Gaussian specular highlight added to emulate ring-light glare | fine_pitch_01 |
| `s02_tqfp_diffuse` | Recorded | fine_pitch_01 |
| `s02_wrong_field` | Recorded (different board) | fine_pitch_02 |
| `s03_before_corroded` | Recorded | corrosion_02 |
| `s03_after_cleaned_synthetic` | **Synthetic**: detected deposit removed with `cv2.inpaint`, view re-framed by a known homography, +6 % gain. Not a physical repair. | corrosion_02 |
| `s03_wrong_region` | Recorded (different board) | clean_08 |
| `s04_overexposed` | Recorded | corrosion_04 |
| `s05_psu_before` / `s05_psu_after` | Recorded genuine rework pair | pairs_01 / pairs_02 |

Synthetic fixtures carry `synthetic: true` and are labelled SYNTHETIC in the UI,
the trace and the report.

## Datasets considered and not used

- **DeepPCB** (github.com/tangsanli5201/DeepPCB): the repository LICENSE file is MIT, but the
  README restricts use to research purposes. Because the terms conflict, it was not redistributed here.
- **PKU PCB defect dataset** (Open Lab on Human Robot Interaction, Peking University): academic use
  only / "All Rights Reserved" on the lab pages, unknown licence on mirrors, and its defects are
  synthetically added. Not used.

## Synthetic test data

`services/vision-api/tests/synth.py` renders PCB-like scenes (IC with gull-wing lead rows, passives,
traces) with exact ground truth for bridges, corrosion and glare. It is used only by unit tests and
the synthetic sections of the evaluation, which say so.
