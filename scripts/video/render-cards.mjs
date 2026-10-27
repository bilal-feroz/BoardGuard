// Renders the motion-graphics cards (scripts/video/cards.html) frame by frame at 30 fps into MP4s.
// Each card lasts lead-in + narration + tail; <outDir>/cards.json records those timings for assembly.
//
//   node scripts/video/render-cards.mjs <narrationDir> <outDir> [--team "A|B"] [--aws URL] [--variant lightsail] [scene ...]
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const team = opt("--team"), aws = opt("--aws"), variant = opt("--variant");
const [NARR, OUT, ...only] = args;
const FPS = 30;
// [narration lead-in, tail] per card, in seconds
const TIMING = { hook: [0.6, 0.9], title: [0.4, 1.3], loop: [0.5, 1.0], arch: [0.5, 1.1], results: [0.5, 1.3], limits: [0.4, 1.2], team: [0.4, 4.2] };
const durations = JSON.parse(fs.readFileSync(path.join(NARR, "durations.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const metaFile = path.join(OUT, "cards.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const html = pathToFileURL(path.resolve("scripts/video/cards.html")).href;

for (const id of only.length ? only : Object.keys(TIMING)) {
  const [lead, tail] = TIMING[id];
  const n = durations[id], d = +(lead + n + tail).toFixed(3);
  const q = new URLSearchParams({ scene: id, n, l: lead, d });
  if (team) q.set("team", team);
  if (aws) q.set("aws", aws);
  if (variant) q.set("variant", variant);
  await page.goto(`${html}?${q}`, { waitUntil: "load" });
  await page.evaluate(() => window.__ready.then(() => true));
  const out = path.join(OUT, `${id}.mp4`);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(d * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.__seek(t), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => ff.on("close", (c) => (c ? reject(new Error(`ffmpeg exited ${c}`)) : resolve())));
  meta[id] = { lead, n, d };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  console.log(`${id}: ${d} s, ${frames} frames`);
}
await browser.close();
