// Records the live BoardGuard workstation for the demo video (real app, real OpenCV 5 processing).
//
//   node scripts/video/record-app.mjs <main|system> <baseUrl> <narrationDir> <outDir>
//
// Frames come from a Chrome DevTools screencast (JPEG, 1920x1080) instead of Playwright's
// 1 Mbit/s VP8 recorder, so UI text stays sharp; <outDir>/frames.json keeps each frame's
// timestamp for a constant-frame-rate encode. The narration paces the run: cue(id) waits
// until the previous segment has been spoken, then logs when the next one starts
// (<outDir>/cues.json). Camera moves are CSS transforms on <body>, so zoomed text is
// re-rendered crisply instead of upscaled.
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [SECTION, BASE, NARR, OUT] = process.argv.slice(2);
const durations = JSON.parse(fs.readFileSync(path.join(NARR, "durations.json"), "utf8"));
const W = 1920, H = 1080, GAP_MS = 500;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole("button", { name }).first();
const shown = (text, timeout = 90_000) => page.getByText(text).filter({ visible: true }).first().waitFor({ timeout });

// ---------------------------------------------------------------- screencast
const cdp = await ctx.newCDPSession(page);
const frames = [];
const writes = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const f = `${String(frames.length).padStart(6, "0")}.jpg`;
  frames.push({ f, t: metadata.timestamp ?? Date.now() / 1000 });
  writes.push(fs.promises.writeFile(path.join(OUT, "frames", f), Buffer.from(data, "base64")));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

// ---------------------------------------------------------------- narration pacing
const cues = [];
let speakingUntil = 0, cueAt = 0;
async function cue(id) {
  if (!(id in durations)) throw new Error(`no narration for ${id}`);
  const wait = speakingUntil - Date.now();
  if (wait > 0) await pause(wait);
  cueAt = Date.now();
  cues.push({ id, t: cueAt / 1000 });
  speakingUntil = cueAt + durations[id] * 1000 + GAP_MS;
  console.log(`cue ${id} (${durations[id]} s)`);
}
const at = async (s) => { const w = cueAt + s * 1000 - Date.now(); if (w > 0) await pause(w); };
const finish = async () => { const w = speakingUntil - Date.now(); if (w > 0) await pause(w); };
// Silent navigation is fast-forwarded 3x in the edit (build.py); the badge discloses it on screen.
const fastSpans = [];
let fastFrom = 0;
async function fast(on) {
  await page.evaluate((on) => window.__ff(on), on);
  if (on) fastFrom = Date.now() / 1000;
  else fastSpans.push([fastFrom, Date.now() / 1000]);
}

// ---------------------------------------------------------------- pointer, key hints, camera
async function overlay() {
  await page.evaluate(() => {
    if (window.__cam) return;
    const root = document.documentElement;
    root.style.overflow = "hidden";
    const st = document.createElement("style");
    st.textContent = `
      #__cursor{position:fixed;left:-80px;top:-80px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
      .__ripple{position:fixed;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;border:2.5px solid #79ADA0;z-index:2147483646;pointer-events:none;animation:__rip .6s ease-out forwards}
      @keyframes __rip{from{transform:scale(.25);opacity:1}to{transform:scale(1.6);opacity:0}}
      #__key{position:fixed;left:50%;top:84px;transform:translateX(-50%) translateY(-8px);z-index:2147483645;display:flex;gap:16px;align-items:center;padding:12px 24px 12px 12px;border-radius:14px;background:rgba(14,19,20,.94);border:1px solid rgba(121,173,160,.55);box-shadow:0 12px 40px rgba(0,0,0,.55);font:500 24px "IBM Plex Sans","Segoe UI",sans-serif;color:#F0F0EB;opacity:0;transition:opacity .25s,transform .25s}
      #__key.on{opacity:1;transform:translateX(-50%)}
      #__key b{display:inline-grid;place-items:center;min-width:50px;height:50px;padding:0 12px;border-radius:10px;background:#F0F0EB;color:#111719;font:600 26px "IBM Plex Mono",Consolas,monospace;box-shadow:inset 0 -5px 0 #9BA7A7}`;
    root.appendChild(st);
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32"><path d="M5 3 L5 25 L10.8 19.4 L14.8 28 L18.6 26.3 L14.7 17.9 L22.8 17.5 Z" fill="#F0F0EB" stroke="#0E1314" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    root.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX - 5 + "px"; c.style.top = e.clientY - 3 + "px"; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "__ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      root.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    const ff = document.createElement("div");
    ff.id = "__ff";
    ff.innerHTML = "<b>▶▶</b> 3× fast-forward";
    ff.style.cssText = "position:fixed;right:28px;top:62px;z-index:2147483645;padding:8px 16px;border-radius:10px;background:rgba(14,19,20,.92);border:1px solid rgba(216,170,104,.7);color:#D8AA68;font:600 20px 'IBM Plex Mono',Consolas,monospace;opacity:0;transition:opacity .2s";
    root.appendChild(ff);
    window.__ff = (on) => { ff.style.opacity = on ? "1" : "0"; };
    const k = document.createElement("div");
    k.id = "__key";
    root.appendChild(k);
    let kt;
    window.__key = (key, label) => {
      k.innerHTML = `<b>${key}</b><span>${label}</span>`;
      k.classList.add("on");
      clearTimeout(kt);
      kt = setTimeout(() => k.classList.remove("on"), 2600);
    };
    window.__camState = { tx: 0, ty: 0, s: 1 };
    window.__cam = (cx, cy, s, ms) => {
      let tx = 0, ty = 0;
      if (s !== 1) {
        tx = Math.min(0, Math.max(innerWidth - innerWidth * s, innerWidth / 2 - cx * s));
        ty = Math.min(0, Math.max(innerHeight - innerHeight * s, innerHeight / 2 - cy * s));
      }
      const b = document.body;
      b.style.transformOrigin = "0 0";
      b.style.transition = `transform ${ms}ms cubic-bezier(.65,0,.35,1)`;
      b.style.transform = s === 1 ? "translate(0px,0px) scale(1)" : `translate(${tx}px,${ty}px) scale(${s})`;
      window.__camState = { tx, ty, s };
    };
    window.__camEl = (el, s, ms, dx, dy) => {
      const r = el.getBoundingClientRect(), c = window.__camState;
      // Bring the element into its scrolling panel (never the page) and aim at where it will land.
      let shift = 0;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (!/(auto|scroll)/.test(oy) || p.scrollHeight <= p.clientHeight) continue;
        const pr = p.getBoundingClientRect();
        const top = (r.top - pr.top) / c.s, h = r.height / c.s;
        if (top < 0 || top + h > p.clientHeight) {
          const target = Math.max(0, Math.min(p.scrollHeight - p.clientHeight, p.scrollTop + top - p.clientHeight / 2 + h / 2));
          shift = target - p.scrollTop;
          p.scrollTo({ top: target, behavior: "smooth" });
        }
        break;
      }
      window.__cam((r.left + r.width / 2 - c.tx) / c.s + dx, (r.top + r.height / 2 - c.ty) / c.s - shift + dy, s, ms);
    };
  });
}
async function camTo(locator, s, ms = 1100, dx = 0, dy = 0) {
  await locator.waitFor();
  await locator.evaluate((el, [s, ms, dx, dy]) => window.__camEl(el, s, ms, dx, dy), [s, ms, dx, dy]);
  await pause(ms + 50);
}
async function camReset(ms = 800) {
  await page.evaluate((ms) => window.__cam(0, 0, 1, ms), ms);
  await pause(ms + 50);
  await page.evaluate(() => { document.documentElement.scrollTop = 0; document.documentElement.scrollLeft = 0; });
}
const keyHint = (k, label) => page.evaluate(([k, label]) => window.__key(k, label), [k, label]);

async function glide(locator, { click = true } = {}) {
  await locator.waitFor();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await pause(160);
  if (click) await locator.click();
}

/** Page coordinates of a point given in microscope image (working) pixels (camera at 1x). */
async function imageToPage(x, y) {
  return page.evaluate(([ix, iy]) => {
    const el = document.querySelector('[role="img"][aria-label^="Microscope capture"]');
    const layer = el.querySelector("div.origin-top-left");
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.e]+)\)/.exec(layer.style.transform);
    const r = el.getBoundingClientRect();
    return [r.left + Number(m[1]) + ix * Number(m[3]), r.top + Number(m[2]) + iy * Number(m[3])];
  }, [x, y]);
}
async function dragImage(from, to, steps = 30) {
  const a = await imageToPage(...from), b = await imageToPage(...to);
  await page.mouse.move(a[0], a[1], { steps: 18 });
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps });
  await page.mouse.up();
}

async function start(url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await overlay();
  await page.mouse.move(W * 0.62, H * 0.55);
  await pause(1500);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await pause(500);
}

// ---------------------------------------------------------------- the run
if (SECTION === "main") {
  await start(BASE);

  await cue("app_intro"); // 3D board, then Scenario 02
  await page.mouse.move(W * 0.36, H * 0.52, { steps: 20 });
  await page.mouse.down();
  await page.mouse.move(W * 0.47, H * 0.46, { steps: 70 });
  await page.mouse.up();
  await at(durations.app_intro * 0.66);
  await glide(btn(/Possible solder bridge under glare/));
  await shown("Agent requests a recapture");

  await cue("app_candidates"); // two candidates, C01 inside the ring-light hotspot
  await pause(400);
  await glide(btn(/^C01/));
  await camTo(page.getByRole("button", { name: "Select C01" }), 2.1, 1300, 10, 55);
  await at(durations.app_candidates * 0.6);
  const mask = btn(/Specular glare mask/);
  await mask.dispatchEvent("click");
  await pause(1100);
  await mask.dispatchEvent("click");
  await at(durations.app_candidates - 0.3);
  await camReset();

  await cue("app_region"); // technician region evidence check over the hotspot
  await pause(300);
  await keyHint("R", "Region evidence check");
  await page.keyboard.press("r");
  await pause(900);
  await dragImage([1440, 610], [1597, 780], 34);
  const panel = page.locator("section", { hasText: "Region evidence check" }).first();
  await panel.getByText("insufficient").first().waitFor();
  await pause(300);
  await camTo(panel, 1.75, 1200, 0, -20);
  await at(durations.app_region - 0.2);
  await camReset();

  await cue("app_request"); // rule R-E1: a specific new observation
  await camTo(page.getByText("Agent requests a recapture").filter({ visible: true }).first(), 1.8, 1100, 0, 85);
  await at(durations.app_request - 0.4);
  await camReset();

  // Diffuse recapture: the analysis wait is fast-forwarded and the narration starts on the result.
  await glide(btn(/TQFP-144 recaptured with diffuse light/));
  await fast(true);
  await shown("Technician review required");
  await pause(300);
  await fast(false);
  await cue("app_reinspect"); // registration and multi-view comparison
  await pause(300);
  await camTo(page.getByText(/\d+ inliers/).filter({ visible: true }).first(), 1.9, 1100, -120, 0);
  await at(durations.app_reinspect * 0.55);
  await camTo(page.getByText("not repr.", { exact: true }).first(), 1.9, 1000, -150, 15);
  await at(durations.app_reinspect * 0.8);
  await camTo(page.getByRole("button", { name: "Select C02" }), 2.5, 1200, 20, 50);
  await at(durations.app_reinspect - 0.2);
  await camReset();

  await cue("app_ruler"); // calibrate from the lead pitch, measure the package body in mm
  await keyHint("M", "Measure · calibrate to millimetres");
  await page.keyboard.press("m");
  await pause(700);
  await page.getByLabel("Package lead pitch").selectOption("0.5");
  await pause(400);
  await glide(page.getByRole("button", { name: "Set", exact: true }).first());
  await shown(/1 px = 0\.0\d+ mm/);
  await pause(300);
  await dragImage([122, 820], [1460, 820], 45);
  await pause(300);
  await camTo(page.locator("svg text").filter({ hasText: / mm$/ }).first(), 2.0, 1100, 0, 20);
  await at(durations.app_ruler - 0.2);
  await camReset();
  await page.keyboard.press("Escape");

  await cue("app_decide"); // dismiss, undo (R-H2), dismiss again, confirm C02
  await glide(btn(/^C01/));
  await glide(page.getByRole("button", { name: "Dismiss", exact: true }));
  const toast = page.getByRole("status").filter({ hasText: "C01 dismissed" });
  await toast.waitFor();
  await camTo(toast, 1.8, 900);
  await at(durations.app_decide * 0.3);
  await glide(toast.getByRole("button", { name: "Undo" }));
  await pause(700);
  await camReset(700);
  await glide(btn(/^C01/));
  await glide(page.getByRole("button", { name: "Dismiss", exact: true }));
  await pause(400);
  await glide(btn(/^C02/));
  await glide(page.getByRole("button", { name: "Confirm suspicion" }));
  await shown(/Electrical verification pending/);
  await camTo(page.getByText(/Electrical verification pending/).filter({ visible: true }).first(), 1.7, 1000, 0, 40);
  await at(durations.app_decide - 0.2);
  await camReset();

  await cue("app_trace"); // evidence chain: every tool call, rule and decision with inputs and outputs
  await glide(btn(/^Evidence$/));
  await pause(900);
  await camTo(page.getByText(/observations \/ outputs/i).first(), 1.4, 1000, -260, 60);
  await at(durations.app_trace - 0.2);
  await camReset();

  // Scenario 03: before/after registration and change map (navigation fast-forwarded)
  await fast(true);
  await glide(btn(/^New$/));
  await glide(btn(/^Inspect$/));
  await glide(btn(/Before \/ after verification/));
  await shown("After-repair capture");
  await pause(400);
  await glide(btn(/Same region after cleaning/));
  await shown("Confirm visual checks");
  await glide(page.getByRole("button", { name: "Verify", exact: true }));
  await shown("REGISTERED");
  await fast(false);
  await cue("app_verify");
  await pause(300);
  const handle = page.getByRole("slider", { name: /Drag to compare/ });
  const hb = await handle.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 15 });
    await page.mouse.down();
    await page.mouse.move(hb.x - 360, hb.y + hb.height / 2, { steps: 45 });
    await page.mouse.move(hb.x + 300, hb.y + hb.height / 2, { steps: 60 });
    await page.mouse.up();
  }
  await glide(page.getByRole("tab", { name: "Difference map" }));
  await pause(2200);

  await cue("app_complete");
  await glide(btn("Confirm visual checks"));
  await shown("Visual reinspection completed");
  await camTo(page.getByText("Visual reinspection completed").filter({ visible: true }).first(), 1.7, 1000, 0, 40);
  await at(durations.app_complete - 0.2);
  await camReset();

  // Scenario 05: unregistrable real pair, overlay withheld (navigation fast-forwarded)
  await fast(true);
  await glide(btn(/^New$/));
  await glide(btn(/^Inspect$/));
  await glide(btn(/Real rework pair/));
  await shown("After-repair capture");
  await glide(btn(/PSU section after capacitor replacement/));
  await shown(/alignment failed/i);
  await pause(400);
  await fast(false);
  await cue("app_withheld");
  await glide(page.getByRole("button", { name: "Verify", exact: true }));
  await shown(/Registration failed/);
  await camTo(page.getByText(/Registration failed/).filter({ visible: true }).first(), 1.6, 1000);
  await finish();
  await pause(600);
} else if (SECTION === "system") {
  await start(BASE);
  await cue("app_system"); // live runtime identity and processing probe
  await glide(btn(/^System$/));
  await pause(700);
  await camTo(page.getByText("Environment", { exact: true }).first(), 1.9, 1100, 120, 70);
  await at(durations.app_system * 0.5);
  await camReset(700);
  await glide(btn("Run probe"));
  await shown("X-BoardGuard-Runtime", 60_000);
  await pause(300);
  await camTo(page.getByText("X-BoardGuard-Runtime").first(), 1.8, 1000, 120, -90);
  await finish();
  await pause(600);
}

await cdp.send("Page.stopScreencast");
await Promise.all(writes);
const end = Date.now() / 1000;
fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ frames, end }));
fs.writeFileSync(path.join(OUT, "cues.json"), JSON.stringify(cues, null, 1));
fs.writeFileSync(path.join(OUT, "fast.json"), JSON.stringify(fastSpans));
await browser.close();
console.log(`${SECTION}: ${frames.length} frames over ${(end - frames[0].t).toFixed(1)} s`);
