// Records the demo video from the running application (no mock footage).
//
//   node scripts/record-demo.mjs [baseUrl] [outDir]
//   default baseUrl http://localhost:8090 (single-origin production build), outDir docs/submission/video
//
// Produces <outDir>/raw.webm (Playwright screen recording at 1920x1080) and
// <outDir>/captions.srt whose cue times are taken from the actual moments each
// step happened during recording. scripts/build-video.ps1 turns them into an MP4.
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = process.argv[2] ?? "http://localhost:8090";
const OUT = path.resolve(process.argv[3] ?? "docs/submission/video");
fs.mkdirSync(OUT, { recursive: true });
const W = 1920, H = 1080;

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
const t0 = Date.now();
const page = await ctx.newPage();

// Visible pointer so viewers can follow interactions (Playwright does not draw the OS cursor).
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border:1.5px solid #F0F0EB;border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.6);transition:transform .12s;left:-50px;top:-50px";
    document.body.appendChild(d);
    addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => (d.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (d.style.transform = "scale(1)"), true);
  });
});

const cues = [];
let open = null;
const now = () => (Date.now() - t0) / 1000;
function caption(text) {
  if (open) open.end = now();
  open = { start: now(), end: null, text };
  cues.push(open);
}
const pause = (ms) => page.waitForTimeout(ms);

async function glide(locator, opts = {}) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await pause(250);
  if (opts.click !== false) await locator.click();
}
const btn = (name) => page.getByRole("button", { name }).first();

await page.goto(BASE, { waitUntil: "networkidle" });
caption("BoardGuard — an AI microscope assistant for electronics repair technicians.");
await pause(5000);
caption("A representative 3D logic board for navigation. Each region links to real microscope captures.");
await page.mouse.move(W * 0.35, H * 0.5, { steps: 20 });
await page.mouse.down();
await page.mouse.move(W * 0.45, H * 0.46, { steps: 40 });
await page.mouse.up();
await pause(2500);

caption("Scenario 02: a fine-pitch TQFP photographed under a ring light. Processing runs live with OpenCV 5.");
await glide(btn(/Possible solder bridge under glare/));
await page.getByText("Agent requests a recapture").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await pause(2500);
caption("Two suspected bridges. C01 sits in a specular hotspot: 28% of its region is glare.");
await glide(btn(/^C01/));
await pause(5000);
caption("The amber layer is the OpenCV specular mask behind the decision (toggled off, then on).");
await glide(btn(/Specular glare mask/));
await pause(1800);
await glide(btn(/Specular glare mask/));
await pause(3000);
caption("Rule R-E1: evidence insufficient. The agent asks for a specific new look instead of guessing.");
await page.getByText(/Reduce specular glare/).filter({ visible: true }).first().scrollIntoViewIfNeeded();
await pause(5000);

caption("The technician recaptures with diffuse light. The new image is registered to the first one.");
await glide(btn(/TQFP-144 recaptured with diffuse light/));
await page.getByText("Technician review required").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await pause(2500);
caption("Reinspection: the glare suspicion is not reproduced, so its priority drops. C02 persists, so its priority rises.");
await pause(8000);
caption("C02 is a fibre lying across two leads. The technician decides; BoardGuard recommends a continuity check.");
await glide(btn(/^C02/));
await pause(3500);
await glide(btn(/^C01/));
await glide(btn("Dismiss"));
await pause(800);
await glide(btn(/^C02/));
await glide(btn("Confirm suspicion"));
await page.getByText(/Electrical verification pending/).filter({ visible: true }).first().waitFor();
await pause(3000);

caption("Every tool call, rule and human decision is traced, timed and exportable.");
await glide(btn(/^Evidence$/));
await pause(2500);
const ev = page.getByRole("button", { name: /Register OBS-002/ }).first();
if (await ev.count()) await glide(ev);
await pause(4500);
caption("Each finding's reinspection outcome is its own decision, citing the rule that fired.");
const ev2 = page.getByRole("button", { name: /C01 not reproduced/ }).first();
if (await ev2.count()) await glide(ev2);
await pause(5000);

caption("Scenario 03: before/after verification. SIFT + MAGSAC registration with measured residuals.");
await glide(btn(/^New$/));
await glide(btn(/^Inspect$/));
await glide(btn(/Before \/ after verification/));
await page.getByText("After-repair capture").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await pause(1500);
await glide(btn(/Same region after cleaning/));
await page.getByText("Confirm visual checks").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await glide(btn(/^Verify$/));
await page.getByText("REGISTERED").filter({ visible: true }).first().waitFor();
await pause(1500);
const handle = page.getByRole("slider", { name: /Drag to compare/ });
const hb = await handle.boundingBox();
if (hb) {
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 15 });
  await page.mouse.down();
  await page.mouse.move(hb.x - 380, hb.y + hb.height / 2, { steps: 50 });
  await page.mouse.move(hb.x + 300, hb.y + hb.height / 2, { steps: 70 });
  await page.mouse.up();
}
await pause(1500);
caption("The difference map shows where the visible change is. It is linked back to each finding.");
await glide(page.getByRole("tab", { name: "Difference map" }));
await pause(5500);
caption("Visible change is documented. Electrical verification stays with the technician.");
await glide(btn("Confirm visual checks"));
await pause(4000);

caption("Scenario 05: a real rework pair shot from different angles. Alignment is unreliable, so no overlay is drawn.");
await glide(btn(/^New$/));
await glide(btn(/^Inspect$/));
await glide(btn(/Real rework pair/));
await page.getByText("After-repair capture").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await glide(btn(/PSU section after capacitor replacement/));
await page.getByText(/alignment failed/).filter({ visible: true }).first().waitFor({ timeout: 90_000 });
await glide(btn(/^Verify$/));
await pause(5000);

caption("System: the live OpenCV 5 runtime, the processing environment, tool contracts and reproducible evaluation.");
await glide(btn(/^System$/));
await pause(2500);
await glide(btn("Run probe"));
await page.getByText("X-BoardGuard-Runtime").filter({ visible: true }).first().waitFor({ timeout: 60_000 });
await pause(3500);
await page.mouse.wheel(0, 650);
await pause(5000);
caption("BoardGuard: see the damage, guide the repair, verify the result. A visual aid that knows when to look again.");
await page.mouse.wheel(0, -650);
await pause(5000);
open.end = now();

const video = page.video();
await ctx.close();
await browser.close();
const raw = await video.path();
fs.renameSync(raw, path.join(OUT, "raw.webm"));
const ts = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
fs.writeFileSync(path.join(OUT, "captions.srt"), cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"));
console.log(`recorded ${now().toFixed(1)} s -> ${path.join(OUT, "raw.webm")} with ${cues.length} captions`);
