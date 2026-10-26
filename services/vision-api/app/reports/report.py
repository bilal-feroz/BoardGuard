"""Inspection report generation (self-contained HTML and JSON).

The HTML report embeds the working-resolution captures and draws candidate
geometry as SVG so it can be archived, printed to PDF from any browser, and
read without the application running.
"""

from __future__ import annotations

import base64
import html
import json
from datetime import datetime, timezone

LIMITATIONS = [
    "BoardGuard is a visual inspection aid. It does not measure electrical continuity, resistance or function; "
    "a photograph cannot prove or exclude a short or open circuit.",
    "Candidates are suspected visual anomalies localised by classical OpenCV image analysis with documented, "
    "hand-calibrated thresholds. Evidence scores are heuristic and are not calibrated probabilities.",
    "Thresholds were calibrated on a small set of public PCB photographs and controlled degradations of them, "
    "not on a validated corpus of repair cases.",
    "Software zoom is not optical magnification; lighting guidance must be carried out physically by the technician.",
    "A visible change between before and after captures documents a visual difference only. It does not establish "
    "that a repair succeeded.",
]


def _img_b64(storage, key: str | None) -> str | None:
    if not key:
        return None
    data = storage.get(key)
    if data is None:
        return None
    mime = "image/png" if key.endswith(".png") else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _e(x) -> str:
    return html.escape(str(x))


def build_json(session: dict, runtime: dict) -> dict:
    return {
        "report_type": "boardguard.inspection_report.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runtime": runtime,
        "inspection": {k: v for k, v in session.items() if k != "trace"},
        "trace": session["trace"],
        "limitations": LIMITATIONS,
    }


def _figure(storage, obs: dict) -> str:
    src = _img_b64(storage, obs["capture_key"])
    if not src:
        return ""
    w, h = obs["width"], obs["height"]
    shapes = []
    for c in obs.get("candidates", []):
        x, y, bw, bh = c["bbox"]
        col = "#D67C73" if c["type"] == "suspected_solder_bridge" else "#D8AA68"
        dash = ' stroke-dasharray="8 6"' if c.get("mapped_only") else ""
        shapes.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" fill="none" stroke="{col}" stroke-width="{max(2, w // 400)}"{dash}/>'
                      f'<text x="{x}" y="{max(14, y - 6)}" fill="{col}" font-size="{max(14, w // 60)}" font-family="monospace">{_e(c["id"])}</text>')
    return (f'<figure><svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'
            f'<image href="{src}" width="{w}" height="{h}"/>{"".join(shapes)}</svg>'
            f'<figcaption>{_e(obs["obs_id"])} · {_e(obs["role"])} · {_e((obs.get("source") or {}).get("label", ""))} · '
            f'{_e((obs.get("source") or {}).get("provenance", ""))}</figcaption></figure>')


def build_html(session: dict, storage, runtime: dict) -> str:
    s = session
    rows_obs = []
    for o in s["observations"]:
        q = o.get("quality") or {}
        m = q.get("metrics", {})
        reg = o.get("registration") or {}
        rows_obs.append(
            f"<tr><td>{_e(o['obs_id'])}</td><td>{_e(o['role'])}</td><td>{o['original_width']}×{o['original_height']}</td>"
            f"<td>{_e(q.get('verdict', '—'))}</td><td>{m.get('blur_metric', '—')}</td><td>{m.get('glare_fraction', '—')}</td>"
            f"<td>{_e(', '.join(r['code'] for r in q.get('reasons', [])) or '—')}</td>"
            f"<td>{_e(reg.get('status', '—'))}{(' · ' + str(reg.get('inliers')) + ' inliers') if reg.get('inliers') else ''}</td></tr>")
    rows_f = []
    for f in s["findings"]:
        tech = f.get("technician") or {}
        hist = " → ".join(h["outcome"] for h in f["history"])
        rows_f.append(
            f"<tr><td>{_e(f['id'])}</td><td>{_e(f['type'].replace('_', ' '))}</td><td>{_e(f['status'])}</td><td>{_e(f['priority'])}</td>"
            f"<td>{f.get('evidence_score') if f.get('evidence_score') is not None else '—'}</td><td>{_e(hist)}</td>"
            f"<td>{_e(tech.get('decision', 'pending'))}{(' — ' + _e(tech['note'])) if tech.get('note') else ''}</td>"
            f"<td>{_e(f['recommended_check'])}</td></tr>")
    rows_t = []
    for ev in s["trace"]:
        trig = ev.get("trigger") or {}
        rows_t.append(
            f"<tr><td>{ev['seq']}</td><td>{_e(ev['timestamp'][11:23])}</td><td>{_e(ev['actor'])}</td><td>{_e(ev['title'])}</td>"
            f"<td>{_e(ev.get('tool') or '')}</td><td>{_e(trig.get('rule', ''))}</td><td>{_e(ev['next_state'])}</td>"
            f"<td>{'' if ev.get('duration_ms') is None else ev['duration_ms']}</td></tr>")
    ver_html = ""
    v = s.get("verification")
    if v:
        reg = v.get("registration") or {}
        ch = v.get("change") or {}
        before = next((o for o in s["observations"] if o["obs_id"] == v["before_obs_id"]), None)
        aligned = _img_b64(storage, ch.get("aligned_after_key"))
        heat = _img_b64(storage, ch.get("heatmap_key"))
        imgs = ""
        if before and aligned:
            bsrc = _img_b64(storage, before["capture_key"])
            imgs = (f'<div class="pair"><figure><img src="{bsrc}"/><figcaption>Before ({_e(before["obs_id"])})</figcaption></figure>'
                    f'<figure><img src="{aligned}"/><figcaption>After, registered to before ({_e(v["after_obs_id"])})</figcaption></figure>'
                    f'<figure class="heat"><img src="{bsrc}"/><img class="ov" src="{heat}"/><figcaption>Change map over before</figcaption></figure></div>')
        links = "".join(
            f"<tr><td>{_e(l['candidate_id'])}</td><td>{l['changed_fraction_in_bbox']:.0%}</td><td>{'yes' if l['visible_change'] else 'no'}</td>"
            f"<td>{'yes' if l['redetected_after'] else 'no'}</td></tr>" for l in ch.get("candidate_links", []))
        ver_html = (
            f"<h2>Before / after verification</h2><p class='kv'>Registration <b>{_e(reg.get('status'))}</b> · method {_e(reg.get('method', '—'))} · "
            f"inliers {reg.get('inliers', '—')} · inlier ratio {reg.get('inlier_ratio', '—')} · RMS {reg.get('rms_reprojection_px', '—')} px · "
            f"coverage {reg.get('inlier_coverage', '—')}</p>"
            + (f"<p class='warn'>{_e('; '.join(reg.get('reasons', [])))}</p>" if reg.get('status') == 'FAILED' else '')
            + imgs
            + (f"<p class='kv'>Changed fraction of valid overlap: {ch.get('changed_fraction', 0):.1%} · {len(ch.get('regions', []))} change regions · "
               f"threshold {ch.get('threshold')}</p><table><tr><th>Finding</th><th>Changed area in bbox</th><th>Visible change</th>"
               f"<th>Still detected after</th></tr>{links}</table>" if ch else "")
            + f"<p>Technician confirmation of visual checks: <b>{'confirmed' if v.get('confirmed_by_technician') else 'pending'}</b>. "
              f"Electrical verification: <b>pending (outside BoardGuard's scope)</b>.</p>")
    tech_log = "".join(
        f"<li>{_e(t['timestamp'][:19].replace('T', ' '))} UTC — {_e(t['type'])}"
        f"{(' · ' + _e(t.get('candidate_id'))) if t.get('candidate_id') else ''}"
        f"{(' · ' + _e(t.get('result'))) if t.get('result') else ''}{(' — ' + _e(t['note'])) if t.get('note') else ''}</li>"
        for t in s["technician_log"]) or "<li>No technician actions recorded.</li>"
    outcome = s.get("outcome") or {"status": s["state"], "summary": "Inspection in progress."}
    figures = "".join(_figure(storage, o) for o in s["observations"])
    lim = "".join(f"<li>{_e(x)}</li>" for x in LIMITATIONS)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BoardGuard report {_e(s['inspection_id'])}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{--ink:#15191a;--muted:#5b6566;--line:#d6dad6;--amber:#9a6a22;--coral:#a5443b;--teal:#2f6f61}}
body{{font:14px/1.5 "Inter","Segoe UI",system-ui,sans-serif;color:var(--ink);background:#fbfbf8;margin:0;padding:32px 40px;max-width:1180px}}
h1{{font-size:20px;margin:0 0 2px}} h2{{font-size:15px;margin:28px 0 8px;padding-top:12px;border-top:1px solid var(--line)}}
.brand{{font:600 12px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;color:var(--teal)}}
.kv,.mono,td{{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:12px}}
table{{border-collapse:collapse;width:100%;margin:6px 0}} th,td{{text-align:left;border-bottom:1px solid var(--line);padding:5px 8px;vertical-align:top}}
th{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}}
figure{{margin:8px 0}} figure svg,figure img{{width:100%;height:auto;display:block;border:1px solid var(--line)}}
figcaption{{font-size:11px;color:var(--muted);margin-top:4px}} .figs{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
.pair{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}} .heat{{position:relative}} .heat .ov{{position:absolute;inset:0;border:0}}
.outcome{{border:1px solid var(--line);border-left:3px solid var(--teal);padding:10px 14px;background:#fff}} .warn{{color:var(--coral)}}
ul{{margin:4px 0;padding-left:18px}} @media print{{body{{padding:0}} h2{{break-after:avoid}} figure{{break-inside:avoid}}}}
</style></head><body>
<div class="brand">BOARDGUARD · VISUAL INSPECTION REPORT</div>
<h1>{_e(s['inspection_id'])}</h1>
<p class="kv">Created {_e(s['created_at'][:19].replace('T', ' '))} UTC · mode {_e(s['mode'])} · board region {_e(s.get('board_region_label') or s.get('board_region') or '—')}
 · scenario {_e(s.get('scenario_id') or '—')} · OpenCV {_e(runtime.get('opencv_version'))} · processed on {_e(runtime.get('environment'))}</p>
<div class="outcome"><b>{_e(outcome['status'])}</b> — {_e(outcome['summary'])}</div>
<h2>Observations</h2><table><tr><th>ID</th><th>Role</th><th>Original size</th><th>Quality</th><th>Blur metric</th><th>Glare fraction</th><th>Reasons</th><th>Registration</th></tr>{''.join(rows_obs)}</table>
<div class="figs">{figures}</div>
<h2>Findings (suspected visual anomalies)</h2><table><tr><th>ID</th><th>Type</th><th>Status</th><th>Priority</th><th>Evidence score*</th><th>History</th><th>Technician</th><th>Recommended check</th></tr>{''.join(rows_f) or '<tr><td colspan=8>No candidates localised.</td></tr>'}</table>
<p class="mono" style="color:var(--muted)">* Heuristic evidence score from image measurements; not a calibrated probability.</p>
{ver_html}
<h2>Technician actions</h2><ul>{tech_log}</ul>
<h2>Agent trace</h2><table><tr><th>#</th><th>Time (UTC)</th><th>Actor</th><th>Event</th><th>Tool</th><th>Rule</th><th>Next state</th><th>ms</th></tr>{''.join(rows_t)}</table>
<h2>Known limitations</h2><ul>{lim}</ul>
<p class="mono" style="color:var(--muted)">Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC by BoardGuard. No technician identity is recorded in the demo; actions are attributed to an unauthenticated user.</p>
<script>if (new URLSearchParams(location.search).has("print")) addEventListener("load", () => setTimeout(() => print(), 300));</script>
</body></html>"""


def dumps(obj) -> str:
    return json.dumps(obj, indent=2, default=str)
