// Interaction checks for the board explorer harness (dev server on :3000).
//   node features/board-explorer/__screens__/behaviour.mjs [outDir]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? path.resolve("features/board-explorer/__screens__/out");
fs.mkdirSync(out, { recursive: true });
const URL = process.env.LAB_URL ?? "http://localhost:3000/lab/board";
const res = [];
const ok = (name, cond, extra = "") => res.push(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
const state = (page) => page.getByTestId("lab-state").textContent();
const waitState = (page, text) =>
  page.waitForFunction((t) => document.querySelector('[data-testid="lab-state"]')?.textContent?.includes(t), text, { timeout: 15_000 });

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
await page.goto(URL);
await page.waitForSelector('[data-board-ready="true"]', { timeout: 60_000 });
await page.waitForTimeout(600);

// screen position of a region's top-left corner (from its projected DOM label)
const anchor = (id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-region-label="${id}"]`);
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
    const host = el.parentElement.getBoundingClientRect();
    return { x: host.left + Number(m[1]), y: host.top + Number(m[2]) };
  }, id);

for (const id of ["REGION-B", "REGION-E"]) {
  const a = await anchor(id);
  await page.mouse.move(a.x + 70, a.y + 60);
  await page.waitForTimeout(120);
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector("canvas")).cursor);
  ok(`hover ${id} shows pointer`, cursor === "pointer", cursor);
  await page.mouse.click(a.x + 70, a.y + 60);
  await page.waitForTimeout(150);
  ok(`click selects ${id}`, (await state(page)).includes(`selected=${id}`), await state(page));
}
await page.mouse.move(700, 450);
await page.mouse.down();
await page.mouse.move(840, 480, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(250);
ok("orbit drag keeps selection", (await state(page)).includes("selected=REGION-E"), await state(page));
await page.mouse.click(1400, 860); // bench background (bottom-left is the Next dev badge)
await page.waitForTimeout(150);
ok("background click clears selection", (await state(page)).includes("selected=none"), await state(page));

// keyboard access
await page.goto(URL);
await page.waitForSelector('[data-board-ready="true"]', { timeout: 60_000 });
let inNav = false;
for (let i = 0; i < 12 && !inNav; i++) {
  await page.keyboard.press("Tab");
  inNav = await page.evaluate(() => !!document.activeElement?.closest('nav[aria-label="Board inspection regions"]'));
}
const navVisible = await page.evaluate(() => document.querySelector('nav[aria-label="Board inspection regions"]').getBoundingClientRect().width > 50);
ok("Tab reaches region list and it becomes visible", inNav && navVisible);
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
ok("Enter selects region", (await state(page)).includes("selected=REGION-A"), await state(page));
await page.screenshot({ path: path.join(out, "keyboard-nav.png") });

// focus flight timing + reduced motion
let t0 = Date.now();
await page.getByTestId("focus-selected").click();
await waitState(page, "settled=REGION-A");
const flight = Date.now() - t0;
ok("animated flight settles in ~1.1-1.6 s", flight > 1000 && flight < 1900, `${flight}ms`);
await page.getByTestId("overview").click();
await waitState(page, "settled=overview");
await page.locator('input[type="checkbox"]').check();
t0 = Date.now();
await page.getByTestId("focus-selected").click();
await waitState(page, "settled=REGION-A");
ok("reduced motion settles immediately", Date.now() - t0 < 400, `${Date.now() - t0}ms`);
await page.getByTestId("overview").click();
await waitState(page, "settled=overview");

// WebGL context loss -> calm notice -> reload
await page.evaluate(() => document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
await page.getByText("3D view paused").waitFor({ timeout: 5000 });
ok("context loss shows notice", true);
await page.screenshot({ path: path.join(out, "context-lost.png") });
await page.getByRole("button", { name: "Reload 3D view" }).click();
await page.waitForSelector('[data-board-ready="true"]', { timeout: 60_000 });
ok("reload restores the 3D view", true);
await browser.close();

// No WebGL -> static fallback that still drives selection
const b2 = await chromium.launch({ args: ["--disable-3d-apis", "--disable-gpu"] });
const p2 = await b2.newPage({ viewport: { width: 1200, height: 800 } });
await p2.goto(URL);
await p2.getByText("Board map · static view").waitFor({ timeout: 30_000 });
await p2.getByRole("button", { name: /REGION-C/ }).first().click();
await p2.waitForTimeout(150);
ok("fallback list selects", (await p2.getByTestId("lab-state").textContent()).includes("selected=REGION-C"));
await p2.screenshot({ path: path.join(out, "fallback.png") });
await b2.close();

console.log(res.join("\n"));
console.log(errs.length ? `errors:\n${errs.join("\n")}` : "no page errors");
