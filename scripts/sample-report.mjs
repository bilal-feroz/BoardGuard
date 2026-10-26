// Runs Scenario 02 end to end through the HTTP API (real processing), records
// technician decisions, and saves the resulting report as PDF + JSON + trace.
//
//   node scripts/sample-report.mjs [apiBase] [outDir]
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const API = process.argv[2] ?? "http://localhost:8000";
const OUT = path.resolve(process.argv[3] ?? "docs/submission/sample-report");
fs.mkdirSync(OUT, { recursive: true });

async function post(p, body, form = false) {
  const res = await fetch(API + p, form ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(`${p}: ${JSON.stringify(j)}`);
  return j;
}
const fixture = (id) => { const f = new FormData(); f.append("fixture_id", id); return f; };

let s = await post("/api/inspections", { mode: "inspection", scenario_id: "S02-bridge-glare", board_region: "REGION-B", board_region_label: "REGION-B · Fine-pitch controller IC" });
const id = s.inspection_id;
s = await post(`/api/inspections/${id}/captures`, fixture("s02_tqfp_ringlight"), true);
console.log("after OBS-001:", s.state, s.pending_action?.rule);
s = await post(`/api/inspections/${id}/captures`, fixture("s02_tqfp_diffuse"), true);
console.log("after OBS-002:", s.state, s.findings.map((f) => `${f.id}:${f.status}/${f.priority}`).join(" "));
for (const f of s.findings) {
  const decision = f.status === "NOT_REPRODUCED" ? "dismiss" : "confirm";
  const note = decision === "dismiss" ? "Not visible under diffuse light; reflection artefact." : "Fibre across adjacent leads; remove and check continuity.";
  s = await post(`/api/inspections/${id}/actions`, { type: "candidate_decision", candidate_id: f.id, decision, note });
}
s = await post(`/api/inspections/${id}/actions`, { type: "finalize", note: "Visual inspection closed; electrical check scheduled." });
console.log("final:", s.state, "-", s.outcome.summary);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${API}/api/inspections/${id}/report.html`, { waitUntil: "networkidle" });
await page.pdf({ path: path.join(OUT, `${id}.pdf`), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
await browser.close();
fs.writeFileSync(path.join(OUT, `${id}-report.json`), await (await fetch(`${API}/api/inspections/${id}/report.json`)).text());
fs.writeFileSync(path.join(OUT, `${id}-trace.json`), await (await fetch(`${API}/api/inspections/${id}/trace`)).text());
console.log("wrote", OUT);
