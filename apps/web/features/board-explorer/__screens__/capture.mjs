// Visual check for the 3D board explorer harness.
// Usage (from apps/web, dev server running on :3000):
//   node features/board-explorer/__screens__/capture.mjs [outDir] [--headed]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.resolve("features/board-explorer/__screens__/out");
const headed = process.argv.includes("--headed");
const base = process.env.LAB_URL ?? "http://localhost:3000/lab/board";
const sizes = (process.env.SIZES ?? "1440x900,1920x1080").split(",").map((s) => s.split("x").map(Number));
const regionId = process.env.REGION ?? "REGION-B";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});

const logs = [];
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`[${w}x${h}] ${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`[${w}x${h}] pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-board-ready="true"]', { timeout: 90_000 });
  // hide the Next.js dev badge so it does not end up in screenshots
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const readyMs = Date.now() - t0;
  const renderer = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  const measures = await page.evaluate(() =>
    performance
      .getEntriesByType("measure")
      .filter((m) => m.name.startsWith("board-explorer"))
      .map((m) => `${m.name.replace("board-explorer:", "")}=${Math.round(m.duration)}ms`)
      .join(" "),
  );
  console.log(`[${w}x${h}] ready in ${readyMs} ms (${measures}), renderer: ${renderer}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, `${w}x${h}-1-overview.png`) });
  await page.locator("[data-board-explorer]").screenshot({ path: path.join(outDir, `${w}x${h}-clean-overview.png`) });

  await page.locator("button", { hasText: regionId }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${w}x${h}-2-selected.png`) });

  // frame-time probe during the camera flight (rAF cadence ~ render cadence with frameloop="demand")
  await page.evaluate(() => {
    window.__ft = [];
    let last = performance.now();
    const tick = (t) => {
      window.__ft.push(t - last);
      last = t;
      if (window.__ft.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const tf = Date.now();
  await page.getByTestId("focus-selected").click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="lab-state"]')?.textContent?.includes(`settled=${id}`), regionId, { timeout: 15_000 });
  console.log(`[${w}x${h}] focus settled after ${Date.now() - tf} ms`);
  const ft = await page.evaluate(() => {
    const a = window.__ft.slice(2).sort((x, y) => x - y);
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    return { fps: Math.round(1000 / avg), p95: a[Math.floor(a.length * 0.95)].toFixed(1), worst: a[a.length - 1].toFixed(1) };
  });
  console.log(`[${w}x${h}] flight frames: ~${ft.fps} fps avg, p95 ${ft.p95} ms, worst ${ft.worst} ms`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${w}x${h}-3-focus.png`) });
  await page.locator("[data-board-explorer]").screenshot({ path: path.join(outDir, `${w}x${h}-clean-${regionId}.png`) });

  await page.getByTestId("overview").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="lab-state"]')?.textContent?.includes("settled=overview"), null, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${w}x${h}-4-back.png`) });
  // optional: frame each extra region top-down for review
  for (const extra of (process.env.EXTRA ?? "").split(",").filter(Boolean)) {
    await page.locator("button", { hasText: extra }).first().click();
    await page.getByTestId("focus-selected").click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="lab-state"]')?.textContent?.includes(`settled=${id}`), extra, { timeout: 15_000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, `${w}x${h}-focus-${extra}.png`) });
    await page.getByTestId("overview").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="lab-state"]')?.textContent?.includes("settled=overview"), null, { timeout: 15_000 });
  }
  await page.close();
}
await browser.close();
console.log(logs.length ? logs.join("\n") : "no console errors or warnings");
console.log(`screenshots in ${outDir}`);
