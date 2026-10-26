import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR; // when set, save documentation screenshots

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function startScenario(page: Page, title: string) {
  await page.goto("/");
  await expect(page.getByText("API offline").filter({ visible: true }).first()).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(title) }).click();
}

test("scenario 02: glare triggers recapture, reinspection changes the decision", async ({ page }) => {
  await startScenario(page, "Possible solder bridge under glare");
  await expect(page.getByText("Agent requests a recapture").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Reduce specular glare/).filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, "s02-recapture-requested");

  await page.getByRole("button", { name: /TQFP-144 recaptured with diffuse light/ }).click();
  await expect(page.getByText("Technician review required").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Not reproduced", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "s02-reinspected");

  // Technician dismisses C01 and confirms C02.
  await page.getByRole("button", { name: /^C01/ }).first().click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: /^C02/ }).first().click();
  await page.getByRole("button", { name: "Confirm suspicion" }).click();
  await expect(page.getByText(/Electrical verification pending/).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("Evidence chain").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("R-M3").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "evidence");
});

test("scenario 03: before/after registration and confirmation", async ({ page }) => {
  await startScenario(page, "Before / after verification");
  await expect(page.getByText("After-repair capture").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Same region after cleaning/ }).click();
  await expect(page.getByText("Confirm visual checks").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("REGISTERED").filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "verify-split");
  await page.getByRole("tab", { name: "Difference map" }).click();
  await page.waitForTimeout(600);
  await shot(page, "verify-diff");
  await page.getByRole("button", { name: "Confirm visual checks" }).click();
  await expect(page.getByText("Visual reinspection completed").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "verify-complete");
  // The report the TopBar links to renders with the embedded captures.
  const report = await page.request.get(await page.getByRole("link", { name: "Report", exact: true }).getAttribute("href") ?? "");
  expect(report.status()).toBe(200);
  const html = await report.text();
  expect(html).toContain("Visual reinspection completed");
  expect(html).toContain("data:image/jpeg;base64");
});

test("scenario 04: unusable capture is rejected before analysis and stops safely", async ({ page }) => {
  await startScenario(page, "Unusable capture");
  await expect(page.getByText("Agent requests a recapture").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("OVEREXPOSED").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Stopped safely").filter({ visible: true }).first()).toBeVisible();
});

test("scenario 05: unregistrable real pair withholds the overlay", async ({ page }) => {
  await startScenario(page, "Real rework pair");
  await page.getByRole("button", { name: /PSU section after capacitor replacement/ }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText(/Registration failed — aligned overlay and change map withheld/).filter({ visible: true }).first()).toBeVisible();
  await shot(page, "verify-withheld");
});

test("system screen shows live OpenCV 5 runtime", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByText(/^5\.\d+\.\d+ \(opencv-python-headless\)/).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Run probe" }).click();
  await expect(page.getByText("X-BoardGuard-Runtime").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "system");
});

/** Page coordinates of a point given in microscope image (working) pixels. */
async function imageToPage(page: Page, x: number, y: number): Promise<[number, number]> {
  return page.evaluate(([ix, iy]) => {
    const el = document.querySelector('[role="img"][aria-label^="Microscope capture"]') as HTMLElement;
    const layer = el.querySelector("div.origin-top-left") as HTMLElement;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.e]+)\)/.exec(layer.style.transform)!;
    const r = el.getBoundingClientRect();
    return [r.left + Number(m[1]) + ix * Number(m[3]), r.top + Number(m[2]) + iy * Number(m[3])] as [number, number];
  }, [x, y]);
}

async function dragImage(page: Page, from: [number, number], to: [number, number]) {
  const a = await imageToPage(page, ...from);
  const b = await imageToPage(page, ...to);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 10 });
  await page.mouse.up();
}

test("region evidence check, calibrated ruler and undo of a technician decision", async ({ page }) => {
  await startScenario(page, "Possible solder bridge under glare");
  await expect(page.getByText("Agent requests a recapture").filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(800);

  // Region check over the ring-light hotspot on the right lead row: glare makes the evidence insufficient.
  await page.keyboard.press("r");
  await dragImage(page, [1440, 610], [1597, 780]);
  const panel = page.locator("section", { hasText: "Region evidence check" });
  await expect(panel.getByText("insufficient").first()).toBeVisible();
  await expect(panel.getByText("GLARE").first()).toBeVisible();
  await expect(page.getByText("Agent requests a recapture").filter({ visible: true }).first()).toBeVisible(); // state unchanged
  await shot(page, "region-check");

  await page.getByRole("button", { name: /TQFP-144 recaptured with diffuse light/ }).click();
  await expect(page.getByText("Technician review required").filter({ visible: true }).first()).toBeVisible();

  // Calibrate from the detected TQFP lead row (0.5 mm pitch), then measure in millimetres.
  await page.keyboard.press("m");
  await page.getByLabel("Package lead pitch").selectOption("0.5");
  await page.getByRole("button", { name: "Set", exact: true }).first().click();
  await expect(page.getByText(/1 px = 0\.0\d+ mm/).filter({ visible: true }).first()).toBeVisible();
  await dragImage(page, [300, 300], [700, 300]);
  await expect(page.locator("svg text").filter({ hasText: / mm$/ }).first()).toBeVisible();
  await shot(page, "calibrated-ruler");
  await page.keyboard.press("Escape");

  // Dismiss C01, then withdraw the decision: the finding returns to review.
  await page.getByRole("button", { name: /^C01/ }).first().click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  const toast = page.getByRole("status").filter({ hasText: "C01 dismissed" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "C01 dismissed" })).toHaveCount(0);
  await shot(page, "undo");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("R-H2").filter({ visible: true }).first()).toBeVisible();
});

test("API outage: offline banner, then automatic recovery", async ({ page }) => {
  let down = true;
  await page.route("**/api/**", (route) => (down ? route.abort("connectionrefused") : route.continue()));
  await page.goto("/");
  await expect(page.getByText("Vision API unreachable").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/API offline · retry in \d+s/).first()).toBeVisible();
  await shot(page, "offline");
  // A manual retry while the API is still down keeps the workstation offline (and counts the attempt).
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByText(/attempt [2-9]/).first()).toBeVisible();
  // Once the API is back, the backoff loop reconnects on its own and loads the scenarios.
  down = false;
  await expect(page.getByText("Vision API unreachable")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Suspected corrosion/ })).toBeVisible();
});

test("upload rejects a non-image with a specific error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New inspection" }).click();
  await expect(page.getByText("Capture required").filter({ visible: true }).first()).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("UNSUPPORTED_FORMAT").filter({ visible: true }).first()).toBeVisible();
});
